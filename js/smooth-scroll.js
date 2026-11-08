// js/smooth-scroll.js
import Lenis from 'lenis';
import 'lenis/dist/lenis.css';
import { animate, inView, scroll } from 'motion';

let lenisInstance = null;
let rafId = null;
let currentMode = null; // 'window' | 'element'
let resizeObserver = null;
let mutationObserver = null;
let windowResizeListener = null;

/**
 * Determines whether the active layout uses the window scroll container (mobile <= 768px)
 * or the .main-content scroll container (desktop > 768px).
 */
function getScrollContext() {
    if (typeof window === 'undefined') return null;

    const mainContent = document.querySelector('.main-content');
    const isMobile =
        window.innerWidth <= 768 ||
        (document.body && window.getComputedStyle(document.body).overflowY !== 'hidden');

    if (isMobile || !mainContent) {
        return {
            mode: 'window',
            wrapper: window,
            content: document.documentElement,
            eventsTarget: window,
        };
    }

    return {
        mode: 'element',
        wrapper: mainContent,
        content: mainContent,
        eventsTarget: window,
    };
}

/**
 * Initializes Lenis smooth scrolling and Motion across the entire application.
 * Dynamically binds to window on mobile and .main-content on desktop,
 * eliminating scroll resistance and deadlocks on all form factors.
 */
export function initSmoothScroll(customOptions = {}) {
    if (typeof window === 'undefined') return null;

    const context = getScrollContext();
    if (!context) return null;

    // Return existing instance if mode is unchanged
    if (lenisInstance && currentMode === context.mode) {
        return lenisInstance;
    }

    // Tear down previous instance if switching modes (e.g. crossing 768px breakpoint)
    if (lenisInstance) {
        destroySmoothScroll();
    }

    currentMode = context.mode;

    const mainContent = document.querySelector('.main-content');
    if (mainContent) {
        mainContent.style.scrollBehavior = 'auto';
    }
    if (document.documentElement) {
        document.documentElement.style.scrollBehavior = 'auto';
    }

    lenisInstance = new Lenis({
        wrapper: context.wrapper,
        content: context.content,
        eventsTarget: context.eventsTarget,
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
        resizeObserver = new ResizeObserver(() => {
            if (lenisInstance) {
                lenisInstance.resize();
            }
        });
        if (mainContent) resizeObserver.observe(mainContent);
        if (document.body) resizeObserver.observe(document.body);
        document.querySelectorAll('.page').forEach((p) => resizeObserver.observe(p));
    }

    if (typeof MutationObserver !== 'undefined') {
        mutationObserver = new MutationObserver(() => {
            if (lenisInstance) {
                lenisInstance.resize();
            }
        });
        const observeTarget = mainContent || document.body;
        if (observeTarget) {
            mutationObserver.observe(observeTarget, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['class', 'style'],
            });
        }
    }

    // Monitor viewport resize to seamlessly transition between mobile and desktop container modes
    if (!windowResizeListener) {
        let resizeTimer = null;
        windowResizeListener = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                const newContext = getScrollContext();
                if (newContext && newContext.mode !== currentMode) {
                    initSmoothScroll(customOptions);
                } else if (lenisInstance) {
                    lenisInstance.resize();
                }
            }, 180);
        };
        window.addEventListener('resize', windowResizeListener, { passive: true });
    }

    // Expose lenis and motion globally for ease of use across modules
    window.lenis = lenisInstance;
    window.motion = { animate, inView, scroll };

    console.log(`[SmoothScroll] Lenis initialized in ${currentMode} mode`);
    return lenisInstance;
}

/**
 * Programmatically scrolls the content to a target position or element.
 */
export function scrollTo(target, options = {}) {
    if (window.lenis) {
        window.lenis.scrollTo(target, options);
    } else {
        const isMobile = window.innerWidth <= 768;
        const mainContent = document.querySelector('.main-content');
        const scrollTarget = isMobile ? window : mainContent;

        if (scrollTarget) {
            if (typeof target === 'number') {
                scrollTarget.scrollTo({
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
        requestAnimationFrame(() => {
            window.lenis?.resize();
        });
    }
}

/**
 * Destroys the Lenis instance and observers.
 */
export function destroySmoothScroll() {
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
    }
    if (mutationObserver) {
        mutationObserver.disconnect();
        mutationObserver = null;
    }
    if (lenisInstance) {
        lenisInstance.destroy();
        lenisInstance = null;
        window.lenis = null;
    }
    currentMode = null;
}

export { animate, inView, scroll, lenisInstance as lenis };
