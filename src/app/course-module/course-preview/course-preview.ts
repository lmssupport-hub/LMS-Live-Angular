import { Location } from '@angular/common';
import {
  AfterViewInit,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { Course } from '../course.model';
import { Section, SectionManagementService } from '../../services/Section management.service';

type ViewMode = 'desktop' | 'tablet' | 'mobile';

/** Extra space below the root (px). The root already has pb-7 (28px) like Organize; raise this only if the admin layout adds its own bottom padding. */
const BOTTOM_GAP = 0;
const MIN_HEIGHT = 520;
/** Up to this many modules fit without scrolling; more than this scroll inside the list. */
const MAX_VISIBLE_MODULES = 8;
const ROW_GAP = 12; // gap-3
/** Row height limits (px). Raise ROW_MAX for taller sections. */
const ROW_MIN = 45;
const ROW_MAX = 60;
const DESKTOP_MIN_WIDTH = 1024;

const GENERIC_ERROR = 'Unable to load the course sections. Please try again.';

@Component({
  selector: 'app-course-preview',
  imports: [],
  host: { class: 'block' },
  templateUrl: './course-preview.html',
  styleUrl: './course-preview.css',
})
export class CoursePreview implements OnInit, AfterViewInit {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly sectionService = inject(SectionManagementService);
  private readonly destroyRef = inject(DestroyRef);

  readonly course = signal<Course | null>(null);
  readonly sections = signal<Section[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  // toolbar state
  readonly readingMode = signal(false);
  readonly viewMode = signal<ViewMode>('desktop');
  readonly isFullscreen = signal(false);

  /** Height that makes the card fill the content area (null = natural height, page may scroll). */
  readonly fitHeight = signal<number | null>(null);

  /** Page background colour of the admin layout (so the toolbar notch blends in). */
  readonly pageBg = signal('#f6f6f6');

  /** Row height: shrinks so MAX_VISIBLE_MODULES rows fit the list area (ROW_MIN - ROW_MAX). */
  readonly rowHeight = computed(() =>
    this.fitHeight() === null
      ? `${ROW_MAX}px`
      : `clamp(${ROW_MIN}px, calc((100cqh - ${ROW_GAP * (MAX_VISIBLE_MODULES - 1)}px) / ${MAX_VISIBLE_MODULES}), ${ROW_MAX}px)`,
  );

  readonly stacked = computed(() => this.viewMode() !== 'desktop');
  readonly moduleCount = computed(() => this.sections().length.toString().padStart(2, '0'));
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
    // The Organize screen stores the course here before navigating (see openPreviewPage()).
    // sessionStorage also survives a refresh of the preview page.
    const courseId = Number(this.route.snapshot.paramMap.get('courseId'));
    this.course.set(this.readStoredCourse(courseId));
    if (this.course()) this.loadSections();
  }

  ngAfterViewInit(): void {
    // wait one tick so the admin layout (sidebar / header) has finished laying out
    this.pageBg.set(this.detectPageBg());
    setTimeout(() => this.updateFit());
    setTimeout(() => this.updateFit(), 200); // second pass once the layout / fonts have settled
  }

  /** First non-transparent background colour found walking up from this component. */
  private detectPageBg(): string {
    let el: HTMLElement | null = this.host.nativeElement.parentElement;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
      el = el.parentElement;
    }
    return '#f6f6f6';
  }

  /** Bottom padding / margin / border of every ancestor - this space must not push the page past the viewport. */
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

  /** Fills the space under the admin header so the page itself never scrolls; only the module list does. */
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

  // ---------- data ----------

  loadSections(): void {
    const course = this.course();
    if (!course) return;
    this.loading.set(true);
    this.error.set('');
    this.sectionService
      .getSections(course.id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: list => {
          this.sections.set([...list].sort((a, b) => a.sectionOrder - b.sectionOrder));
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(err instanceof Error && err.message ? err.message : GENERIC_ERROR);
        },
      });
  }

  private readStoredCourse(courseId: number): Course | null {
    try {
      const raw = sessionStorage.getItem(`course-preview:${courseId}`);
      return raw ? (JSON.parse(raw) as Course) : null;
    } catch {
      return null;
    }
  }

  // ---------- navigation ----------

  /** Clicking a module row opens the content viewer (E-Book / Multimedia / Question Banks) for that section. */
  openSection(section: Section): void {
    const course = this.course();
    if (!course) return;
    void this.router.navigate([
      '/admin-dashboard',
      'courses',
      course.id,
      'sections',
      section.id,
      'content',
    ]);
  }

  // ---------- display helpers (same logic as Organize) ----------

  thumbnail(): string | null {
    const raw = (this.course() as (Course & { thumbnailUrl?: string | null }) | null)?.thumbnailUrl;
    if (!raw) return null;
    return /^https?:\/\//i.test(raw)
      ? raw
      : `${environment.apiBaseUrl}${raw.startsWith('/') ? '' : '/'}${raw}`;
  }

  levelLabel(level: unknown): string {
    if (typeof level !== 'string' || !level) return '';
    const text = level.replace(/_/g, ' ').toLowerCase();
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  /** Beginner = 1 green dot, Intermediate = 2, Advanced = 3. */
  levelDots(level: unknown): number {
    const value = typeof level === 'string' ? level.toLowerCase() : '';
    if (value.includes('advanced')) return 3;
    if (value.includes('intermediate')) return 2;
    return value ? 1 : 0;
  }

  instructorInitial(): string {
    return (this.course()?.instructorName ?? '').trim().charAt(0);
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