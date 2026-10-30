import { Location } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { forkJoin, of } from 'rxjs';
import { catchError } from 'rxjs/operators';

import { Section, SectionManagementService } from '../../services/Section management.service';
import { MultimediaManagementService } from '../../services/multimedia-management.service';
import { QuestionBankService } from '../../services/question-bank.service';
import { ApiBankResponse } from '../question-bank.model';
import { MultimediaResource, extensionOf, trustedMediaUrl } from '../multimedia.model';

type ViewMode = 'desktop' | 'tablet' | 'mobile';
type TabKind = 'Multimedia' | 'Question Bank';
type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'docx' | 'office' | 'other';

interface ContentTab {
  key: string;
  label: string;
  kind: TabKind;
  /** createdAt timestamp (ms) - used to show the tabs in the order they were added. */
  addedAt: number;
  resource?: MultimediaResource;
  bankId?: number;
}

interface ActiveMedia {
  kind: MediaKind;
  /** Plain https URL (image / video / audio / download link). */
  url: string | null;
  /** Sanitized URL for the <iframe> (PDF directly, Office files through Microsoft's embed viewer). */
  frameUrl: SafeResourceUrl | null;
}

const MIN_HEIGHT = 520;
const BOTTOM_GAP = 0;
const DESKTOP_MIN_WIDTH = 1024;

const OFFICE_EXTENSIONS: ReadonlySet<string> = new Set(['docx', 'pptx', 'xlsx']);

@Component({
  selector: 'app-course-content-viewer',
  imports: [],
  host: { class: 'block' },
  templateUrl: './course-content-viewer.html',
  styleUrl: './course-content-viewer.css',
})
export class CourseContentViewer implements OnInit, AfterViewInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly sectionService = inject(SectionManagementService);
  private readonly multimediaService = inject(MultimediaManagementService);
  private readonly questionBankService = inject(QuestionBankService);

  private courseId = 0;

  // ---------- data ----------
  readonly sections = signal<Section[]>([]);
  readonly selectedSectionId = signal<number | null>(null);
  readonly tabs = signal<ContentTab[]>([]);
  readonly activeTabKey = signal<string>('');
  readonly loading = signal(false);
  readonly error = signal('');

  /** Which online viewer renders DOCX / PPTX / XLSX. Switchable if one of them can't open the file. */
  readonly officeViewer = signal<'microsoft' | 'google'>('microsoft');

  toggleOfficeViewer(): void {
    this.officeViewer.update(v => (v === 'microsoft' ? 'google' : 'microsoft'));
  }

  /** True while the Office embed iframe is still loading (Microsoft/Google fetch the file server-side). */
  readonly frameLoading = signal(false);

  /** DOCX is rendered locally in the browser with docx-preview (no Microsoft/Google server involved). */
  private readonly docxHost = viewChild<ElementRef<HTMLDivElement>>('docxHost');
  readonly docxLoading = signal(false);
  /** Tab key whose local DOCX render failed (e.g. CORS) - that tab falls back to the online viewer. */
  private readonly docxFailedKey = signal('');
  private docxToken = 0;
  /** Downloaded DOCX files (by URL), so a tab opens instantly if it was prefetched or opened before. */
  private readonly docxCache = new Map<string, Promise<Blob>>();

  private fetchDocx(url: string): Promise<Blob> {
    let cached = this.docxCache.get(url);
    if (!cached) {
      cached = fetch(url).then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.blob();
      });
      cached.catch(() => this.docxCache.delete(url)); // don't cache failures
      this.docxCache.set(url, cached);
    }
    return cached;
  }

  /** Background-download the section's DOCX files (and load docx-preview) while the user reads the first tab. */
  private prefetchDocx(tabs: ContentTab[]): void {
    this.docxCache.clear();
    const urls = tabs
      .map(t => t.resource)
      .filter((r): r is MultimediaResource => !!r)
      .filter(r => (extensionOf(r.originalFileName) || (r.fileExtension ?? '').toLowerCase()) === 'docx')
      .map(r => trustedMediaUrl(r.fileUrl))
      .filter((u): u is string => !!u)
      .slice(0, 5);
    if (!urls.length) return;
    void import('docx-preview');
    urls.forEach(u => this.fetchDocx(u).catch(() => undefined));
  }

  constructor() {
    // Whenever the active media changes (new tab or viewer switched), show the spinner again for Office files.
    effect(() => {
      this.frameLoading.set(this.activeMedia()?.kind === 'office');
    });

    // Re-check the tab arrows whenever the tabs or the preview size change.
    effect(() => {
      this.tabs();
      this.viewMode();
      this.tabStrip();
      setTimeout(() => this.updateTabScroll());
    });

    // Render DOCX locally once its host <div> exists in the template.
    effect(() => {
      const media = this.activeMedia();
      const host = this.docxHost()?.nativeElement;
      if (media?.kind !== 'docx' || !media.url || !host) return;
      const url = media.url;
      untracked(() => void this.renderDocx(url, host));
    });
  }

  private async renderDocx(url: string, host: HTMLElement): Promise<void> {
    const token = ++this.docxToken;
    const tabKey = this.activeTabKey();
    this.docxLoading.set(true);
    host.innerHTML = '';
    try {
      const blob = await this.fetchDocx(url);
      if (token !== this.docxToken) return;
      const { renderAsync } = await import('docx-preview');
      if (token !== this.docxToken) return;
      await renderAsync(blob, host, undefined, {
        className: 'docx',
        inWrapper: true,
        breakPages: true,
      });
    } catch {
      // Could not fetch/render locally (CORS, corrupt file...) -> fall back to the online viewer for this tab.
      if (token === this.docxToken) this.docxFailedKey.set(tabKey);
    } finally {
      if (token === this.docxToken) this.docxLoading.set(false);
    }
  }

  onFrameLoaded(): void {
    this.frameLoading.set(false);
  }

  // ---------- tab strip scrolling (the arrows scroll the tabs; they do not change the selected tab) ----------
  private readonly tabStrip = viewChild<ElementRef<HTMLDivElement>>('tabStrip');
  readonly canScrollLeft = signal(false);
  readonly canScrollRight = signal(false);

  scrollTabs(direction: -1 | 1): void {
    const el = this.tabStrip()?.nativeElement;
    if (!el) return;
    el.scrollBy({ left: direction * Math.max(120, el.clientWidth * 0.7), behavior: 'smooth' });
  }

  updateTabScroll(): void {
    const el = this.tabStrip()?.nativeElement;
    if (!el) {
      this.canScrollLeft.set(false);
      this.canScrollRight.set(false);
      return;
    }
    this.canScrollLeft.set(el.scrollLeft > 1);
    this.canScrollRight.set(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }

  @HostListener('window:resize')
  onTabStripResize(): void {
    this.updateTabScroll();
  }

  readonly activeTab = computed(() => this.tabs().find(t => t.key === this.activeTabKey()) ?? null);
  readonly activeIndex = computed(() => this.tabs().findIndex(t => t.key === this.activeTabKey()));
  readonly canPrev = computed(() => this.activeIndex() > 0);
  readonly canNext = computed(() => this.activeIndex() >= 0 && this.activeIndex() < this.tabs().length - 1);

  /**
   * Computed once per active tab (NOT in a template method) so the iframe gets the same
   * SafeResourceUrl object on every change detection run and doesn't reload.
   */
  readonly activeMedia = computed<ActiveMedia | null>(() => {
    const resource = this.activeTab()?.resource;
    if (!resource) return null;

    const url = trustedMediaUrl(resource.fileUrl);
    if (!url) return { kind: 'other', url: null, frameUrl: null };

    const ext = extensionOf(resource.originalFileName) || (resource.fileExtension ?? '').toLowerCase();
    if (['jpg', 'jpeg', 'png'].includes(ext)) return { kind: 'image', url, frameUrl: null };
    if (ext === 'mp4') return { kind: 'video', url, frameUrl: null };
    if (ext === 'mp3') return { kind: 'audio', url, frameUrl: null };
    if (ext === 'pdf') {
      return { kind: 'pdf', url, frameUrl: this.sanitizer.bypassSecurityTrustResourceUrl(url) };
    }
    if (ext === 'docx' && this.docxFailedKey() !== this.activeTabKey()) {
      return { kind: 'docx', url, frameUrl: null };
    }
    if (OFFICE_EXTENSIONS.has(ext)) {
      const embed =
        this.officeViewer() === 'microsoft'
          ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`
          : `https://docs.google.com/gview?embedded=true&url=${encodeURIComponent(url)}`;
      return { kind: 'office', url, frameUrl: this.sanitizer.bypassSecurityTrustResourceUrl(embed) };
    }
    return { kind: 'other', url, frameUrl: null }; // e.g. ZIP: cannot be displayed, download only
  });

  // ---------- toolbar ----------
  readonly readingMode = signal(false);
  readonly viewMode = signal<ViewMode>('desktop');
  readonly isFullscreen = signal(false);
  readonly fitHeight = signal<number | null>(null);
  readonly pageBg = signal('#f6f6f6');

  readonly stacked = computed(() => this.viewMode() !== 'desktop');
  readonly frameWidthClass = computed(() => {
    switch (this.viewMode()) {
      case 'tablet':
        return 'max-w-[820px]';
      case 'mobile':
        return 'max-w-[400px]';
      default:
        return 'h-full max-w-none';
    }
  });

  ngOnInit(): void {
    this.courseId = Number(this.route.snapshot.paramMap.get('courseId'));
    this.selectedSectionId.set(Number(this.route.snapshot.paramMap.get('sectionId')) || null);
    this.loadSections();
  }

  ngAfterViewInit(): void {
    this.pageBg.set(this.detectPageBg());
    setTimeout(() => this.updateFit());
    setTimeout(() => this.updateFit(), 200);
  }

  // ---------- layout fit (same approach as the course preview page) ----------
  private detectPageBg(): string {
    let el: HTMLElement | null = this.host.nativeElement.parentElement;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
      el = el.parentElement;
    }
    return '#f6f6f6';
  }

  private ancestorsBottomSpace(): number {
    let total = 0;
    let el: HTMLElement | null = this.host.nativeElement.parentElement;
    while (el) {
      const cs = getComputedStyle(el);
      total +=
        (parseFloat(cs.paddingBottom) || 0) +
        (parseFloat(cs.marginBottom) || 0) +
        (parseFloat(cs.borderBottomWidth) || 0);
      el = el.parentElement;
    }
    return total;
  }

  @HostListener('window:resize')
  updateFit(): void {
    if (this.stacked() || window.innerWidth < DESKTOP_MIN_WIDTH) {
      this.fitHeight.set(null);
      return;
    }
    const top = this.host.nativeElement.getBoundingClientRect().top + window.scrollY;
    const available = window.innerHeight - top - this.ancestorsBottomSpace() - BOTTOM_GAP - 1;
    this.fitHeight.set(Math.max(MIN_HEIGHT, Math.floor(available)));
  }

  // ---------- loading ----------
  loadSections(): void {
    if (!this.courseId) {
      this.error.set('Course not found.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.sectionService
      .getSections(this.courseId)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: list => {
          const sorted = [...list].sort((a, b) => a.sectionOrder - b.sectionOrder);
          this.sections.set(sorted);
          const current = this.selectedSectionId();
          this.selectedSectionId.set(sorted.some(s => s.id === current) ? current : (sorted[0]?.id ?? null));
          this.loadTabs();
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(err instanceof Error && err.message ? err.message : 'Unable to load the course content.');
        },
      });
  }

  /** Tabs = only what was added to this section, in the same order as the Organize screen list. */
  private loadTabs(): void {
    const sectionId = this.selectedSectionId();
    if (sectionId === null) {
      this.tabs.set([]);
      this.activeTabKey.set('');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    forkJoin({
      resources: this.multimediaService
        .getResources(this.courseId, sectionId)
        .pipe(catchError(() => of([] as MultimediaResource[]))),
      banks: this.questionBankService
        .listBanks(this.courseId, sectionId)
        .pipe(catchError(() => of([] as ApiBankResponse[]))),
    })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(({ resources, banks }) => {
        const items: ContentTab[] = [
          ...resources.map(r => ({
            key: `mm-${r.id}`,
            label: r.name,
            kind: 'Multimedia' as const,
            addedAt: this.timeOf(r.createdAt),
            resource: r,
          })),
          ...[...banks].sort((x, y) => x.bankOrder - y.bankOrder).map(b => ({
            key: `qb-${b.id}`,
            label: b.name,
            kind: 'Question Bank' as const,
            addedAt: this.timeOf(b.createdAt),
            bankId: b.id,
          })),
        ];
        // Same order as the Organize screen: multimedia rows first (oldest first), then question banks.
        this.tabs.set(items);
        this.activeTabKey.set(items[0]?.key ?? '');
        this.loading.set(false);
        this.prefetchDocx(items);
      });
  }

  private timeOf(iso: string | undefined): number {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER;
  }

  // ---------- section / tab navigation ----------
  sectionLabel(section: Section): string {
    return `${section.sectionOrder.toString().padStart(2, '0')} - ${section.name}`;
  }

  onSectionChange(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    if (!id) return;
    this.selectedSectionId.set(id);
    // keep the URL in sync so a refresh stays on the same section (no extra history entry)
    void this.router.navigate(
      ['/admin-dashboard', 'courses', this.courseId, 'sections', id, 'content'],
      { replaceUrl: true },
    );
    this.loadTabs();
  }

  selectTab(key: string): void {
    this.activeTabKey.set(key);
  }

  step(direction: -1 | 1): void {
    const next = this.tabs()[this.activeIndex() + direction];
    if (next) this.activeTabKey.set(next.key);
  }

  openQuiz(bankId: number | undefined): void {
    const sectionId = this.selectedSectionId();
    if (!bankId || sectionId === null) return;
    void this.router.navigate([
      '/admin-dashboard',
      'courses',
      this.courseId,
      'sections',
      sectionId,
      'question-banks',
      bankId,
    ]);
  }

  // ---------- toolbar ----------
  toggleReadingMode(): void {
    this.readingMode.update(v => !v);
  }

  setViewMode(event: Event): void {
    this.viewMode.set((event.target as HTMLSelectElement).value as ViewMode);
    this.updateFit();
  }

  toggleFullscreen(): void {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      document.documentElement.requestFullscreen().catch(() => undefined);
    }
  }

  @HostListener('document:fullscreenchange')
  onFullscreenChange(): void {
    this.isFullscreen.set(!!document.fullscreenElement);
    setTimeout(() => this.updateFit());
  }

  back(): void {
    this.location.back();
  }
}