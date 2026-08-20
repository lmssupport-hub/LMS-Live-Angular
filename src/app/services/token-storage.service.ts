import { Injectable } from '@angular/core';

const TOKEN_KEY = 'vativa_access_token';
const USER_KEY = 'vativa_auth_user';


@Injectable({ providedIn: 'root' })
export class TokenStorageService {
  save(token: string, user: unknown, persist: boolean): void {
    this.clear();
    const store = persist ? this.local() : this.session();
    store?.setItem(TOKEN_KEY, token);
    store?.setItem(USER_KEY, JSON.stringify(user));
  }

  updateUser(user: unknown): void {
    this.activeStore()?.setItem(USER_KEY, JSON.stringify(user));
  }

  getToken(): string | null {
    return this.activeStore()?.getItem(TOKEN_KEY) ?? null;
  }

  getUser<T>(): T | null {
    const raw = this.activeStore()?.getItem(USER_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.clear();
      return null;
    }
  }

  clear(): void {
    this.local()?.removeItem(TOKEN_KEY);
    this.local()?.removeItem(USER_KEY);
    this.session()?.removeItem(TOKEN_KEY);
    this.session()?.removeItem(USER_KEY);
  }

  /** local storage wins if a token somehow exists in both (shouldn't happen post-`clear()` on every login). */
  private activeStore(): Storage | null {
    if (this.local()?.getItem(TOKEN_KEY)) return this.local();
    if (this.session()?.getItem(TOKEN_KEY)) return this.session();
    return null;
  }

  private local(): Storage | null {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  }

  private session(): Storage | null {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  }
}