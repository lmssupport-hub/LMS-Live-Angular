import { NgOptimizedImage } from '@angular/common';
import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';



@Component({
  selector: 'app-header',
  imports: [RouterLink, RouterLinkActive, NgOptimizedImage, ],
  templateUrl: './header.html',
  styleUrl: './header.css',
})
export class Header {
  readonly menuOpen = signal(false);
  readonly queriesOpen = signal(false);

  toggleMenu() {
    this.menuOpen.update((open) => !open);
  }

  closeMenu() {
    this.menuOpen.set(false);
  }

  openQueries() {
    this.queriesOpen.set(true);
    this.menuOpen.set(false);
  }

  closeQueries() {
    this.queriesOpen.set(false);
  }
  scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

}