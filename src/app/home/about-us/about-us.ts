import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
type SocialNetwork = {
  name: 'Facebook' | 'LinkedIn' | 'Instagram';
  url: string | null;
};

type TeamMember = {
  name: string;
  role: string;
  image: string | null;
  socials: SocialNetwork[];
};

@Component({
  selector: 'app-about-us',
   imports: [NgOptimizedImage],
  templateUrl: './about-us.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'closeSocialMenu($event)',
  },
})
export class AboutUs {

    scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  readonly openSocialMenu = signal<number | null>(null);

  readonly team: TeamMember[] = [
    {
      name: 'Mahalakshmi',
      role: 'Founder',
      image: '/imgcomponent/about-us/mahalakshmi.png',
      socials: this.createSocialLinks(),
    },
    {
      name: 'Savitha Ramalingam',
      role: 'Founder',
      image: '/imgcomponent/about-us/savitha-ramalingam.png',
      socials: this.createSocialLinks(),
    },
    {
      name: 'Singaravelan',
      role: 'Developer',
      image: '/imgcomponent/about-us/singaravelan.png',
      socials: this.createSocialLinks(),
    },
    {
      name: 'Bathresh Bas B',
      role: 'Designer',
      image: '/imgcomponent/about-us/bathresh-bas-b.png',
      socials: this.createSocialLinks(),
    },
    {
      name: 'Sangeetha Ilavaram',
      role: 'Tester',
      image: '/imgcomponent/about-us/sangeetha-ilavaram.png',
      socials: this.createSocialLinks(),
    },
    {
      name: 'Sreeja',
      role: 'Technical Support',
      image: null,
      socials: this.createSocialLinks(),
    },
    {
      name: 'Maheshwari',
      role: 'Analyst',
      image: '/imgcomponent/about-us/maheshwari.png',
      socials: this.createSocialLinks(),
    },
  ];

  toggleSocialMenu(index: number): void {
    this.openSocialMenu.update((openIndex) => (openIndex === index ? null : index));
  }

  closeSocialMenu(event: MouseEvent): void {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('[data-social-menu]')) {
      this.openSocialMenu.set(null);
    }
  }

  private createSocialLinks(): SocialNetwork[] {
    return [
      { name: 'Facebook', url: null },
      { name: 'LinkedIn', url: null },
      { name: 'Instagram', url: null },
    ];
  }
}
