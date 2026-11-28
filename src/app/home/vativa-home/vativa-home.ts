import { NgOptimizedImage } from '@angular/common';
import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  signal,
  viewChild,
} from '@angular/core';
import { RouterLink } from '@angular/router';


type Service = {
  cardTitle: string;
  title: string;
  tab: string;
  description: string;
  image: string;
  imageAlt: string;
  panelImage: string;
  cardClass: string;
  panelClass: string;
};

type Faq = {
  before: string;
  highlight: string;
  answer: string;
};

type Testimonial = {
  quote: string;
  name: string;
  place: string;
};

@Component({
  selector: 'app-vativa-home',
  imports: [NgOptimizedImage, RouterLink],
  templateUrl: './vativa-home.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VativaHome implements AfterViewInit, OnDestroy {
  

  // ===== Services =====
  readonly servicePanelOpen = signal(false);
  readonly selectedServiceIndex = signal(2);
  private wheelLocked = false;
  readonly serviceColors = signal<string[]>([]);

  // ===== Testimonials =====
  readonly tIndex = signal(0);
  readonly tAnimate = signal(true);
  private testimonialInterval: ReturnType<typeof setInterval> | undefined;

  // ===== FAQ =====
    readonly faqSet = signal(1); // 0 = cards 1-3, 1 = cards 4-6
  readonly faqPos = signal(-1); // highlight aagura card (0-5), -1 = none
    private faqVisible = false;
  private readonly faqSection = viewChild.required<ElementRef<HTMLElement>>('faqSection');
  private faqObserver: IntersectionObserver | undefined;
  private faqAnimationInterval: ReturnType<typeof setInterval> | undefined;

  readonly services: Service[] = [
    {
      cardTitle: 'Video & Stimulation',
      title: 'Video & Stimulations',
      tab: 'Video & Stimulations',
      description:
        'Vativa produces dynamic video and simulation content to enhance learning outcomes. Whether through instructional videos, virtual simulations, or interactive scenarios, their multimedia solutions captivate learners, facilitate concept comprehension, and foster an immersive learning experience across various subjects and industries.',
      image: '/imgcomponent/vativa-home/video-simulations.png',
      panelImage: '/imgcomponent/vativa-home/vid.png',
      imageAlt: 'Video editing and simulation tools arranged around a desktop workstation',
      cardClass: 'bg-[#7936c8]',
      panelClass: 'bg-[#985ee7] text-white',
    },
    {
      cardTitle: 'Digital Marketing',
      title: 'Digital Marketing',
      tab: 'Digital Marketing',
      description:
        'Vativa offers comprehensive digital marketing solutions to promote educational initiatives effectively. From targeted social media campaigns to search engine optimization (SEO) strategies, their digital marketing services help clients increase brand visibility, attract learners, and drive engagement with educational content.',
      image: '/imgcomponent/vativa-home/digital-marketing.png',
      panelImage: '/imgcomponent/vativa-home/Dig%20mar.png',
      imageAlt: 'Digital marketing tools, analytics, and campaign resources',
      cardClass: 'bg-[#c4a066]',
      panelClass: 'bg-[#e3c795] text-[#333]',
    },
    {
      cardTitle: 'LMS Integration/ Development',
      title: 'Learning Management System',
      tab: 'Lms Integration / Development',
      description:
        'Vativa offers seamless integration of their educational content with existing Learning Management Systems (LMS) or develops custom LMS solutions. This ensures that clients can efficiently manage and deliver training materials, track learner progress, and administer assessments within a unified platform.',
      image: '/imgcomponent/vativa-home/lms-integration.png',
      panelImage: '/imgcomponent/vativa-home/LMS.png',
      imageAlt: 'Learning management system components connected to a dashboard',
      cardClass: 'bg-[#3556d1]',
      panelClass: 'bg-[#415cda] text-white',
    },
    {
      cardTitle: 'Content Development',
      title: 'Content Development',
      tab: 'Content development',
      description:
        "Vativa specializes in crafting high-quality educational content tailored to clients' needs. From curriculum design to interactive materials, their content development service ensures engaging and informative learning experiences that align with educational goals and objectives.",
      image: '/imgcomponent/vativa-home/content-development.png',
      panelImage: '/imgcomponent/vativa-home/Con%20dev.png',
      imageAlt: 'Digital content development resources including writing and video',
      cardClass: 'bg-[#f2b52c]',
      panelClass: 'bg-[#f6c757] text-[#333]',
    },
    {
      cardTitle: 'E-Learning Services',
      title: 'E - Learning Services',
      tab: 'E-Learning Services',
      description:
        'Vativa excels in creating interactive e-learning modules and courses. Leveraging cutting-edge technology and instructional design principles, they develop engaging online learning experiences that cater to diverse audiences and facilitate effective knowledge transfer in a digital environment.',
      image: '/imgcomponent/vativa-home/e-learning.png',
      panelImage: '/imgcomponent/vativa-home/E-learn.png',
      imageAlt: 'E-learning courses displayed on a laptop with learning resources',
      cardClass: 'bg-[#ea4957]',
      panelClass: 'bg-[#eb6e8e] text-white',
    },
  ];

  // panel-la tabs top → bottom order
  readonly tabOrder = [2, 3, 4, 1, 0];

  readonly testimonials: Testimonial[] = [
    {
      quote:
        '“Vativahub Team Integrated The Activities And Videos Into Our Training Modules – It Made Our 150+ Learning Units More Interactive And Effective.”',
      name: 'Barry Standfield',
      place: 'Australia',
    },
    {
      quote:
        '“Vativahub Streamlined Our Digital Marketing Process And Delivered Exactly What We Needed, Quickly And Effectively.”',
      name: 'Jeff Quiane',
      place: 'America',
    },
    {
      quote:
        '“Vativahub Team Is Great, Will Use Again” "Instructions Were Very Clear. Hope To Work With You In Future. Thank You- Ian,"',
      name: 'Ian',
      place: 'United States (US)',
    },
    {
      quote:
        '“Thank You Vativahub For The Content Development Work. Your Quality Of Work And Communication Was Top Notch And Would Reach Out To You For Additional Projects. This Is Very Helpful 😊”',
      name: 'Manprit',
      place: 'Australia',
    },
    {
      quote:
        '“I Was Nervous About Moving My Classes Online. The Team Made It Feel Less Like A Business Deal And More Like A Partnership. They Walked With Me, Step By Step.”',
      name: 'Tamil Selvi',
      place: 'India',
    },
    {
      quote:
        '“Vativahub Team Did A Very Good Job In Creating A 40 Minute Learning Unit With Articulate Rise And We Are Looking Forward To Also Work On New Projects In The Future.”',
      name: 'Oliver Schneewind',
      place: 'Germany',
    },
  ];

  // loop seamless-ah irukka mudhal 2 testimonials-ah kadaisila clone pannirukkom
  readonly testimonialLoop: Testimonial[] = [...this.testimonials, ...this.testimonials.slice(0, 2)];

  readonly faqCards: Faq[] = [
    { before: 'Can I integrate the', highlight: 'LMS with other systems?', answer: 'Absolutely' },
    { before: 'Can learners receive', highlight: 'certificates after completing courses?', answer: 'Of course' },
    { before: 'Is the LMS suitable for', highlight: 'organizations of different sizes?', answer: 'Definitely' },
    { before: 'Can I access', highlight: 'the LMS from any device?', answer: 'Yep' },
    { before: 'Can I', highlight: 'create and manage online courses?', answer: 'Definitely' },
    { before: 'Does the LMS support', highlight: 'learner progress tracking?', answer: 'For Sure' },
  ];

  ngAfterViewInit(): void {
    this.loadServiceColors();

    if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    this.testimonialInterval = setInterval(() => this.advanceTestimonial(), 2600);

    if (typeof IntersectionObserver === 'undefined') {
      return;
    }

       this.faqObserver = new IntersectionObserver(([entry]) => {
      if (!entry) {
        return;
      }

      if (entry.intersectionRatio >= 0.35 && !this.faqVisible) {
        this.faqVisible = true;
            this.showFaq(3); // 3 = "Yep" card
        this.startFaqTimer();
      } else if (!entry.isIntersecting) {
        this.resetFaq();
      }
    }, { threshold: [0, 0.35] });

    this.faqObserver.observe(this.faqSection().nativeElement);
  }

  ngOnDestroy(): void {
    this.faqObserver?.disconnect();
        this.stopFaqTimer();
    if (this.testimonialInterval !== undefined) {
      clearInterval(this.testimonialInterval);
    }
  }

 

  // ===== Services =====
  selectService(index: number): void {
    this.selectedServiceIndex.set(index);
  }
  

  onCardClick(index: number): void {
    if (index === this.selectedServiceIndex()) {
      this.servicePanelOpen.set(true);
    } else {
      this.selectedServiceIndex.set(index);
    }
  }

  closeServicePanel(): void {
    this.servicePanelOpen.set(false);
  }
// ===== Page =====
scrollToTop(): void {
  if (typeof window === 'undefined') {
    return;
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
  openServicePanel(): void {
    this.servicePanelOpen.set(true);
  }

  tabOffset(index: number): number {
    return this.tabOrder.indexOf(index) - this.tabOrder.indexOf(this.selectedServiceIndex());
  }

  private tabLength(index: number): number {
    return this.services[index].tab.length * 7.4;
  }

  private tabShift(index: number): number {
    const from = this.tabOrder.indexOf(this.selectedServiceIndex());
    const to = this.tabOrder.indexOf(index);
    if (from === to) {
      return 0;
    }
    const dir = to > from ? 1 : -1;
    let dist = 0;
    for (let cur = from; cur !== to; cur += dir) {
      dist +=
        this.tabLength(this.tabOrder[cur]) / 2 + 32 + this.tabLength(this.tabOrder[cur + dir]) / 2;
    }
    return dir * dist;
  }

  tabY(index: number): number {
  // active tab = panel centre (top-1/2); mathadhu neighbour-ah shift mattum
  return this.tabShift(index);
}

  serviceCardOffset(index: number): number {
    const total = this.services.length;
    let offset = index - this.selectedServiceIndex();

    if (offset > Math.floor(total / 2)) {
      offset -= total;
    } else if (offset < -Math.floor(total / 2)) {
      offset += total;
    }

    return offset;
  }

  serviceCardTransform(index: number): string {
    const offset = this.serviceCardOffset(index);
    const abs = Math.abs(offset);
    const x = Math.sign(offset) * (abs === 1 ? 60 : abs >= 2 ? 110 : 0);
    const scale = abs === 0 ? 1 : abs === 1 ? 0.8 : 0.58;
    return `translateX(${x}%) scale(${scale})`;
  }

  serviceCardZIndex(index: number): number {
    return 10 - Math.abs(this.serviceCardOffset(index));
  }

  // image-oda left-edge color-ah eduthu card/panel background-ah set pannum
  private loadServiceColors(): void {
    if (typeof window === 'undefined') {
      return;
    }

    this.services.forEach((service, i) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return;
        }
        ctx.drawImage(img, 6, Math.floor(img.height / 2), 1, 1, 0, 0, 1, 1);
        const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
        if (a < 250) {
          return;
        }
        this.serviceColors.update((list) => {
          const next = [...list];
          next[i] = `rgb(${r}, ${g}, ${b})`;
          return next;
        });
      };
      img.src = service.image;
    });
  }

    // mouse scroll pannina panel/tab move aagum
  onPanelWheel(event: WheelEvent): void {
    if (!this.servicePanelOpen()) {
      return;
    }

    const pos = this.tabOrder.indexOf(this.selectedServiceIndex());
    const next = pos + (event.deltaY > 0 ? 1 : -1);

    if (next < 0 || next >= this.tabOrder.length) {
      return;
    }

    event.preventDefault();

    if (this.wheelLocked || Math.abs(event.deltaY) < 8) {
      return;
    }

    this.wheelLocked = true;
    this.selectedServiceIndex.set(this.tabOrder[next]);
    setTimeout(() => (this.wheelLocked = false), 800);
  }

  // carousel-la left/right scroll (trackpad swipe / shift + wheel) panna card maarum
    
  private justDragged = false;
  dragStartX: number | null = null;

  /** Trackpad / shift+wheel left-right */
  onCarouselWheel(event: WheelEvent): void {
    // Vertical scroll-na page scroll aaga vidanum
    if (Math.abs(event.deltaX) <= Math.abs(event.deltaY) || Math.abs(event.deltaX) < 8) return;

    event.preventDefault();
    if (this.wheelLocked) return;

    this.wheelLocked = true;
    setTimeout(() => (this.wheelLocked = false), 700); // card animation (duration-700) mudiyura varai

    this.stepService(event.deltaX > 0 ? 1 : -1);
  }

  /** Mouse drag / touch swipe */
  onCarouselPointerDown(event: PointerEvent): void {
    this.dragStartX = event.clientX;
  }

  onCarouselPointerUp(event: PointerEvent): void {
    if (this.dragStartX === null) return;
    const dx = event.clientX - this.dragStartX;
    this.dragStartX = null;

    if (Math.abs(dx) > 50) {
      this.justDragged = true; // drag-ku aprm card click aagi panel open aagama irukka
      setTimeout(() => (this.justDragged = false), 0);
      this.stepService(dx < 0 ? 1 : -1);
    }
  }

  private stepService(direction: 1 | -1): void {
    const next = this.selectedServiceIndex() + direction;
    if (next < 0 || next >= this.services.length) return;
    this.selectService(next);
  }
  // ===== Testimonials =====
  private advanceTestimonial(): void {
    const n = this.testimonials.length;
    this.tAnimate.set(true);
    this.tIndex.update((i) => i + 1);

    if (this.tIndex() === n) {
      // clone-ku vandhutom; animation mudinja piragu animation illaama 0-ku maarum
      setTimeout(() => {
        this.tAnimate.set(false);
        this.tIndex.set(0);
      }, 950);
    }
  }

   // ===== FAQ =====
  toggleFaqSet(): void {
    const nextSet = this.faqSet() === 0 ? 1 : 0;

    if (!this.faqVisible) {
      this.faqSet.set(nextSet);
      this.faqPos.set(-1);
      return;
    }

    // andha page-oda first card-la irundhu start
    this.showFaq(nextSet * 3);
    this.startFaqTimer();
  }

  hoverFaq(index: number): void {
    this.stopFaqTimer();
    this.faqPos.set(index);
  }

  leaveFaq(): void {
    if (this.faqVisible) {
      this.startFaqTimer();
    } else {
      this.faqPos.set(-1);
    }
  }

  private showFaq(index: number): void {
    this.faqPos.set(index);
    this.faqSet.set(index < 3 ? 0 : 1);
  }

  private startFaqTimer(): void {
    this.stopFaqTimer();
    this.faqAnimationInterval = setInterval(() => {
      this.showFaq((this.faqPos() + 1) % this.faqCards.length);
    }, 2000);
  }

  private stopFaqTimer(): void {
    if (this.faqAnimationInterval !== undefined) {
      clearInterval(this.faqAnimationInterval);
      this.faqAnimationInterval = undefined;
    }
  }

  private resetFaq(): void {
    this.faqVisible = false;
    this.stopFaqTimer();
    this.faqPos.set(-1);
    this.faqSet.set(0);
  }
}