import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { Observable, Subscription } from 'rxjs';
import { finalize } from 'rxjs/operators';

import { AuthService } from '../../../services/auth';
import {
  MultimediaApiError,
  MultimediaManagementService,
} from '../../../services/multimedia-management.service';
import {
  DUPLICATE_NAME_HINT,
  MultimediaRequest,
  MultimediaResource,
  MultimediaSaveResult,
  PreviewType,
  RESOURCE_GROUP_EXTENSIONS,
  RESOURCE_GROUP_LABELS,
  ResourceGroup,
  SERVER_FILE_ERRORS,
  UploadEvent,
  ALLOWED_EXTENSIONS,
  extensionOf,
  formatBytes,
  groupOfExtension,
  groupOfKind,
  matchesFileSignature,
  mismatchMessage,
  normalizeResourceName,
  previewTypeOf,
  toResourceGroup,
  trustedMediaUrl,
  validateResourceDescription,
  validateResourceName,
  validateUploadFile,
} from '../../multimedia.model';

/** Same roles the backend allows (MultimediaService.MANAGE_ROLES). UI gating only - the server enforces. */
const UPLOAD_ROLES: ReadonlySet<string> = new Set(['ADMIN', 'SUPER_ADMIN', 'INSTRUCTOR']);
/** ASSUMPTION: adjust to your login route. */
const LOGIN_ROUTE = '/login';

const REQUIRED_FIELDS_MESSAGE = 'Please complete all required fields.'; // SRS Field List #5
const UNSAVED_CHANGES_MESSAGE = 'You have unsaved changes. Are you sure you want to leave?'; // SRS Field List #6
const UPLOAD_IN_PROGRESS_MESSAGE = 'An upload is in progress. Leaving now will cancel it. Are you sure you want to leave?';
const UPLOAD_FAILED_MESSAGE = 'Upload failed. Please check your internet connection and try again.'; // SRS Edge Case #4
const GENERIC_ERROR =
  'Unable to complete the requested action due to a server error. Please try again later.'; // SRS Edge Case #5

type Field = 'name' | 'type';

/**
 * The finished template calls `<event>.emit(...)`. These adapters route every call to a handler
 * method on this component, so the markup stays untouched. Replace the seven calls in the HTML with
 * direct method calls if you would rather drop this indirection.
 */
interface Emitter<T = void> {
  emit(value: T): void;
}
const emitter = <T = void>(handler: (value: T) => void): Emitter<T> => ({ emit: handler });

/**
 * Multimedia upload / edit dialog (SRS M3F1).
 *
 * Usage:
 *   <app-multimedia-upload [courseId]="course.id" [sectionId]="sectionId" [resource]="resourceOrNull"
 *                          (resourceSaved)="onSaved($event)" (closed)="onClosed()" />
 * `resource` = null -> upload a new resource, otherwise edit that resource.
 */
@Component({
  selector: 'app-multimedia-upload',
  imports: [],
  templateUrl: './multimedia-upload.html',
  styleUrl: './multimedia-upload.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MultimediaUpload implements OnInit {
  // ---------------------------------------------------------------------
  // public API
  // ---------------------------------------------------------------------
  readonly courseId = input.required<number>();
  readonly sectionId = input.required<number>();
  readonly resource = input<MultimediaResource | null>(null);

  readonly resourceSaved = output<MultimediaSaveResult>();
  readonly closed = output<void>();

  // ---------------------------------------------------------------------
  // dependencies
  // ---------------------------------------------------------------------
  private readonly multimedia = inject(MultimediaManagementService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly destroyRef = inject(DestroyRef);

  // ---------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------
  private readonly name = signal('');
  private readonly description = signal('');
  private readonly type = signal<ResourceGroup | ''>('');
  private readonly file = signal<File | null>(null);
  private readonly objectUrl = signal<string | null>(null);
  private readonly existing = signal<MultimediaResource | null>(null);

  private readonly previewShown = signal(false);
  private readonly isSaving = signal(false);
  private readonly fileChecking = signal(false);
  private readonly percent = signal(0);
  private readonly persisted = signal(false);

  private readonly touched = signal<ReadonlySet<Field>>(new Set());
  private readonly showAllErrors = signal(false);
  private readonly fileError = signal('');
  private readonly previewError = signal('');
  private readonly nameServerError = signal('');
  private readonly generalError = signal('');

  private uploadSub: Subscription | null = null;
  private fileCheckToken = 0;

  // ---------------------------------------------------------------------
  // derived state
  // ---------------------------------------------------------------------
  private readonly userCanUpload = computed(() =>
    UPLOAD_ROLES.has((this.auth.user()?.role ?? '').toUpperCase()),
  );
  private readonly isEdit = computed(() => this.existing() !== null);
  private readonly normalizedName = computed(() => normalizeResourceName(this.name()));
  private readonly nameIssue = computed(() => validateResourceName(this.normalizedName()));
  private readonly descriptionIssue = computed(() => validateResourceDescription(this.description()));
  private readonly typeIssue = computed(() => (this.type() ? '' : 'Resource Type is required.'));
  private readonly hasFile = computed(() => this.file() !== null || this.existing() !== null);

  /** Edit mode: the chosen type no longer fits the stored file, so a replacement file is required. */
  private readonly existingTypeConflict = computed(() => {
    const current = this.existing();
    const type = this.type();
    return !!current && !this.file() && !!type && type !== groupOfKind(current.resourceType);
  });

  private readonly remoteUrl = computed(() => {
    const current = this.existing();
    return current ? trustedMediaUrl(current.fileUrl) : null;
  });
  private readonly currentPreviewUrl = computed(
    () => this.objectUrl() ?? (this.file() ? null : this.remoteUrl()),
  );
  private readonly previewKind = computed<PreviewType>(() => {
    if (!this.currentPreviewUrl()) return 'none';
    const picked = this.file();
    return previewTypeOf(picked ? extensionOf(picked.name) : (this.existing()?.fileExtension ?? ''));
  });
  /**
   * The only place a URL is marked trusted. It is a blob: URL created here from a file whose
   * signature was verified, or an https URL on an allow-listed media host (trustedMediaUrl).
   */
  private readonly safePdfUrl = computed<SafeResourceUrl | null>(() => {
    const url = this.currentPreviewUrl();
    const safeSource = !!url && (url.startsWith('blob:') || url === this.remoteUrl());
    return safeSource && this.previewKind() === 'pdf'
      ? this.sanitizer.bypassSecurityTrustResourceUrl(url)
      : null;
  });

  private readonly hasUnsavedChanges = computed(() => {
    if (this.persisted()) return false;
    if (this.isSaving()) return true;
    const current = this.existing();
    if (current) {
      return (
        this.normalizedName() !== current.name ||
        this.description().trim() !== (current.description ?? '') ||
        this.file() !== null
      );
    }
    return !!(this.normalizedName() || this.description().trim() || this.file() || this.type());
  });

  /** SRS: Save is enabled only when every mandatory field is valid. */
  private readonly canSaveNow = computed(
    () =>
      this.userCanUpload() &&
      !this.isSaving() &&
      !this.fileChecking() &&
      !this.fileError() &&
      !this.nameServerError() &&
      !this.nameIssue() &&
      !this.descriptionIssue() &&
      !this.typeIssue() &&
      this.hasFile() &&
      !this.existingTypeConflict() &&
      (!this.isEdit() || this.hasUnsavedChanges()),
  );

  // ---------------------------------------------------------------------
  // template contract (plain values - the finished HTML reads properties, not signals)
  // ---------------------------------------------------------------------
  protected readonly kind = 'Multimedia';

  protected get previewVisible(): boolean {
    return this.previewShown();
  }
  protected get previewType(): PreviewType {
    return this.previewKind();
  }
  protected get previewUrl(): string | null {
    return this.currentPreviewUrl();
  }
  protected get safePreviewUrl(): SafeResourceUrl | null {
    return this.safePdfUrl();
  }
  protected get resourceName(): string {
    return this.name();
  }
  protected get resourceDescription(): string {
    return this.description();
  }
  protected get resourceType(): string {
    return this.type();
  }
  protected get resourceFile(): File | null {
    return this.file();
  }
  protected get resourceFileSize(): string {
    const picked = this.file();
    if (picked) return formatBytes(picked.size);
    const current = this.existing();
    return current ? formatBytes(current.fileSize) : '';
  }
  protected get resourceNameError(): string {
    return this.nameServerError() || (this.isRevealed('name') ? this.nameIssue() : '');
  }
  protected get resourceTypeError(): string {
    return this.isRevealed('type') ? this.typeIssue() : '';
  }
  protected get resourceDescriptionError(): string {
    return this.descriptionIssue();
  }
  protected get resourceFileError(): string {
    if (this.fileError()) return this.fileError();
    if (this.existingTypeConflict() && this.type()) {
      return `Select a ${RESOURCE_GROUP_LABELS[this.type() as ResourceGroup].toLowerCase()} file to change the resource type.`;
    }
    return this.showAllErrors() && !this.hasFile() ? 'File is required.' : '';
  }
  protected get resourcePreviewError(): string {
    return this.previewError();
  }
  protected get error(): string {
    return this.generalError();
  }
  protected get acceptedFileTypes(): string {
    const group = this.type();
    const extensions = group ? RESOURCE_GROUP_EXTENSIONS[group] : [...ALLOWED_EXTENSIONS];
    return extensions.map(ext => `.${ext}`).join(',');
  }
  protected get canUpload(): boolean {
    return this.userCanUpload();
  }
  protected get saving(): boolean {
    return this.isSaving();
  }
  protected get canSave(): boolean {
    return this.canSaveNow();
  }
  /** 0-100 while uploading. Not shown by the current template; bind it to a progress bar if wanted. */
  protected get uploadPercent(): number {
    return this.percent();
  }

  protected readonly nameChanged = emitter<string>(value => this.onNameChanged(value));
  protected readonly descriptionChanged = emitter<string>(value => this.onDescriptionChanged(value));
  protected readonly resourceTypeChanged = emitter<string>(value => this.onResourceTypeChanged(value));
  protected readonly fileSelected = emitter<Event>(event => void this.onFileSelected(event));
  protected readonly previewToggled = emitter(() => this.previewShown.update(shown => !shown));
  protected readonly cancelled = emitter(() => this.onCancel());
  protected readonly saved = emitter(() => this.onSave());

  // ---------------------------------------------------------------------
  // lifecycle
  // ---------------------------------------------------------------------
  constructor() {
    this.destroyRef.onDestroy(() => {
      this.uploadSub?.unsubscribe(); // aborts the in-flight request (SRS Edge Case #6)
      const url = this.objectUrl();
      if (url) URL.revokeObjectURL(url);
    });
  }

  ngOnInit(): void {
    const current = this.resource();
    if (!current) return;
    this.existing.set(current);
    this.name.set(current.name);
    this.description.set(current.description ?? '');
    this.type.set(groupOfKind(current.resourceType));
  }

  /** SRS Edge Cases #2 / #3 / #6: warn before a refresh or tab close discards the upload. */
  @HostListener('window:beforeunload', ['$event'])
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.hasUnsavedChanges()) {
      event.preventDefault();
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.onCancel();
  }

  // ---------------------------------------------------------------------
  // field handlers
  // ---------------------------------------------------------------------
  private onNameChanged(value: string): void {
    this.name.set(typeof value === 'string' ? value : '');
    this.touch('name');
    this.nameServerError.set('');
    this.generalError.set('');
  }

  private onDescriptionChanged(value: string): void {
    this.description.set(typeof value === 'string' ? value : '');
    this.generalError.set('');
  }

  private onResourceTypeChanged(value: string): void {
    const group = toResourceGroup(value); // the value comes from the DOM - never trust it
    this.type.set(group ?? '');
    this.touch('type');
    this.fileError.set('');
    this.generalError.set('');

    const picked = this.file();
    if (picked && group && !RESOURCE_GROUP_EXTENSIONS[group].includes(extensionOf(picked.name))) {
      this.discardFile();
      this.fileError.set(mismatchMessage(group));
    }
  }

  private async onFileSelected(event: Event): Promise<void> {
    const input = event.target instanceof HTMLInputElement ? event.target : null;
    const picked = input?.files?.item(0) ?? null;
    if (input) input.value = ''; // lets the user re-pick the same file; we keep our own File reference
    if (!picked || this.isSaving()) return;

    const token = ++this.fileCheckToken;
    this.showAllErrors.set(true);
    this.fileChecking.set(true);
    this.fileError.set('');
    this.generalError.set('');

    try {
      const ext = extensionOf(picked.name);
      let issue = validateUploadFile(picked, this.type());
      if (!issue && !(await matchesFileSignature(picked, ext))) {
        issue = 'Unsupported file format.';
      }
      if (token !== this.fileCheckToken) return; // a newer pick superseded this one

      if (issue) {
        this.discardFile();
        this.fileError.set(issue);
        return;
      }
      this.acceptFile(picked, ext);
    } catch {
      if (token === this.fileCheckToken) {
        this.discardFile();
        this.fileError.set('Unable to read the selected file. Please try again.');
      }
    } finally {
      if (token === this.fileCheckToken) this.fileChecking.set(false);
    }
  }

  // ---------------------------------------------------------------------
  // save / cancel
  // ---------------------------------------------------------------------
  private onSave(): void {
    if (this.isSaving()) return; // SRS Edge Case #1: only the first click is processed

    if (!this.canSaveNow()) {
      this.showAllErrors.set(true);
      this.generalError.set(REQUIRED_FIELDS_MESSAGE);
      return;
    }

    const courseId = this.courseId();
    const sectionId = this.sectionId();
    const current = this.existing();
    const picked = this.file();
    const request: MultimediaRequest = {
      name: this.normalizedName(),
      description: this.description().trim() || null,
    };

    let call$: Observable<UploadEvent>;
    if (current) {
      call$ = this.multimedia.updateResource(courseId, sectionId, current.id, request, picked);
    } else if (picked) {
      call$ = this.multimedia.uploadResource(courseId, sectionId, request, picked);
    } else {
      return; // unreachable: canSaveNow() requires a file when creating
    }

    this.generalError.set('');
    this.percent.set(0);
    this.isSaving.set(true);

    this.uploadSub = call$
      .pipe(
        finalize(() => {
          this.isSaving.set(false);
          this.uploadSub = null;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe({
        next: event => {
          if (event.kind === 'progress') {
            this.percent.set(event.percent);
          } else {
            this.persisted.set(true);
            this.resourceSaved.emit({ resource: event.resource, created: !current });
          }
        },
        error: (err: unknown) => this.onSaveError(err),
      });
  }

  private onSaveError(err: unknown): void {
    const apiError = err instanceof MultimediaApiError ? err : null;
    const message = apiError?.message ?? GENERIC_ERROR;

    if (apiError?.status === 401) {
      // SRS Edge Case #7: session expired -> sign in again; nothing was uploaded.
      this.generalError.set(message);
      this.auth.logout();
      void this.router.navigate([LOGIN_ROUTE]);
      return;
    }
    if (apiError?.status === 0) {
      this.generalError.set(UPLOAD_FAILED_MESSAGE); // Save stays enabled -> the user can upload again
      return;
    }
    if (message.includes(DUPLICATE_NAME_HINT)) {
      this.nameServerError.set(message);
      return;
    }
    if (SERVER_FILE_ERRORS.has(message)) {
      this.fileError.set(message);
      return;
    }
    this.generalError.set(message);
  }

  private onCancel(): void {
    if (this.hasUnsavedChanges() && !this.confirmLeave()) return;
    this.uploadSub?.unsubscribe();
    this.closed.emit();
  }

  /**
   * The finished template has no discard dialog, so this uses the browser confirm (SRS Field List #6).
   * Swap for your styled confirmation modal when one is available for this screen.
   */
  private confirmLeave(): boolean {
    const message = this.isSaving() ? UPLOAD_IN_PROGRESS_MESSAGE : UNSAVED_CHANGES_MESSAGE;
    return typeof window === 'undefined' ? true : window.confirm(message);
  }

  // ---------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------
  private acceptFile(picked: File, ext: string): void {
    this.revokeObjectUrl();
    this.file.set(picked);
    this.previewError.set('');
    try {
      this.objectUrl.set(URL.createObjectURL(picked));
    } catch {
      this.objectUrl.set(null);
      this.previewError.set('Preview is not available for this file.');
    }
    if (!this.type()) this.type.set(groupOfExtension(ext)); // infer the type when the user has not chosen one
  }

  private discardFile(): void {
    this.revokeObjectUrl();
    this.file.set(null);
  }

  private revokeObjectUrl(): void {
    const url = this.objectUrl();
    if (url) URL.revokeObjectURL(url); // avoids leaking the blob for the lifetime of the page
    this.objectUrl.set(null);
  }

  private touch(field: Field): void {
    this.touched.update(current => new Set(current).add(field));
  }

  private isRevealed(field: Field): boolean {
    return this.showAllErrors() || this.touched().has(field);
  }
}