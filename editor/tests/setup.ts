import '@testing-library/jest-dom/vitest';

// Mock ResizeObserver (required by React Flow)
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as any;

// Mock IntersectionObserver
class IntersectionObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.IntersectionObserver = IntersectionObserverMock as any;

// Mock DOMMatrixReadOnly (used by React Flow transforms)
if (typeof globalThis.DOMMatrixReadOnly === 'undefined') {
  (globalThis as any).DOMMatrixReadOnly = class DOMMatrixReadOnly {
    m22: number;
    constructor(init?: string | number[]) {
      const values = Array.isArray(init) ? init : [1, 0, 0, 1, 0, 0];
      this.m22 = values[3] ?? 1;
    }
  };
}

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock element measurements for React Flow
Element.prototype.getBoundingClientRect = function () {
  return {
    x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0,
    width: 1000, height: 800,
    toJSON: () => {},
  } as DOMRect;
};
