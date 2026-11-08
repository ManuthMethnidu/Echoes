// js/smooth-scroll.js
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { animate, inView, scroll } from 'motion';

let lenisInstance = null;
let rafId = null;

/**
 * Initializes Lenis smooth scrolling and Motion across the entire application.
 * Tuned to eliminate scroll resistance on wheels, trackpads, and touch devices,
 * providing a frictionless, responsive, and buttery-smooth feel.
 */
export function initSmoothScroll(customOptions = {}) {
    if (typeof window === 'undefined') return null;

    if (lenisInstance) {
        return lenisInstance;
    }

    const mainContent = document.querySelector('.main-content');
    if (!mainContent) {
        console.warn('[SmoothScroll] .main-content not found, smooth scrolling not initialized');
        return null;
    }

    // Disable CSS smooth scrolling to prevent jitter and heavy scroll resistance with Lenis RAF
    mainContent.style.scrollBehavior = 'auto';

    lenisInstance = new Lenis({
        wrapper: mainContent,
        content: mainContent,
        eventsTarget: window,
        // Responsive duration (0.95s) prevents the "heavy/sluggish" drag of 1.2s+ durations
        duration: 0.95,
        // Smooth exponential deceleration easing
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        orientation: 'vertical',
        gestureOrientation: 'vertical',
        smoothWheel: true,
        // 1.15 multiplier gives instant, responsive scroll travel with zero resistance
        wheelMultiplier: 1.15,
        touchMultiplier: 1.5,
        // syncTouch: false ensures mobile and touch devices retain native 60/120fps frictionless momentum
        syncTouch: false,
        overscroll: true,
        prevent: (node) => {
            // Let inner scrollable panels (lyrics, queue drawer, modals, sidebars) scroll natively without interference
            if (!node || typeof node.closest !== 'function') return false;

            // Never prevent scrolling on regular controls inside the settings page
            if (node.closest('#page-settings')) {
                const textarea = node.closest('textarea');
                if (textarea && textarea.scrollHeight > textarea.clientHeight) {
                    return true;
                }
                const autoeqList = node.closest('#autoeq-database-list');
                if (autoeqList && autoeqList.scrollHeight > autoeqList.clientHeight) {
                    return true;
                }
                return false;
            }

            return Boolean(
                node.closest(
                    '[data-lenis-prevent], .sidebar, .sidebar-content, .modal, .dialog, .queue-panel, .queue-content, .lyrics-panel, .lyrics-container, .panel-content'
                )
            );
        },
        ...customOptions,
    });

    function raf(time) {
        if (lenisInstance) {
            lenisInstance.raf(time);
        }
        rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    // Automatically recalculate scroll boundaries when dynamic content updates
    if (typeof ResizeObserver !== 'undefined') {
        const resizeObserver = new ResizeObserver(() => {
            if (lenisInstance) {
                lenisInstance.resize();
            }
        });
        resizeObserver.observe(mainContent);
        document.querySelectorAll('.page').forEach((p) => resizeObserver.observe(p));
    }

    if (typeof MutationObserver !== 'undefined') {
        const mutationObserver = new MutationObserver(() => {
            if (lenisInstance) {
                lenisInstance.resize();
            }
        });
        mutationObserver.observe(mainContent, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['class', 'style'],
        });
    }

    // Expose lenis and motion globally for ease of use across modules
    window.lenis = lenisInstance;
    window.motion = { animate, inView, scroll };

    console.log('[SmoothScroll] Lenis and Motion initialized with low-resistance tuning');
    return lenisInstance;
}

/**
 * Programmatically scrolls the main content to a target position or element.
 */
export function scrollTo(target, options = {}) {
    if (window.lenis) {
        window.lenis.scrollTo(target, options);
    } else {
        const mainContent = document.querySelector('.main-content');
        if (mainContent) {
            if (typeof target === 'number') {
                mainContent.scrollTo({
                    top: target,
                    behavior: options.immediate ? 'auto' : 'smooth',
                });
            } else if (target instanceof HTMLElement) {
                target.scrollIntoView({
                    behavior: options.immediate ? 'auto' : 'smooth',
                });
            }
        }
    }
}

/**
 * Resizes Lenis dimensions when page content updates.
 */
export function resizeScroll() {
    if (window.lenis) {
        window.lenis.resize();
    }
}

/**
 * Destroys the Lenis instance if needed.
 */
export function destroySmoothScroll() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (lenisInstance) {
        lenisInstance.destroy();
        lenisInstance = null;
        window.lenis = null;
    }
}

export { animate, inView, scroll, lenisInstance as lenis };
