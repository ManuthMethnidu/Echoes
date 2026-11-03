// js/analytics.js - Vercel Analytics & Plausible Analytics tracking

import { inject as injectVercelAnalytics, track as trackVercelEvent } from '@vercel/analytics';
import { analyticsSettings } from './storage.js';

/**
 * Check if analytics is enabled
 * @returns {boolean}
 */
function isAnalyticsEnabled() {
    return analyticsSettings.isEnabled();
}

/**
 * Track a custom event with Vercel Analytics and Plausible
 * @param {string} eventName - The name of the event
 * @param {object} [props] - Optional event properties
 */
export function trackEvent(eventName, props = {}) {
    if (!isAnalyticsEnabled()) return;

    // Track event via Vercel Web Analytics
    try {
        trackVercelEvent(eventName, props);
    } catch {}

    // Track event via Plausible if present
    if (window.plausible) {
        try {
            window.plausible(eventName, { props });
        } catch {
            // Silently fail if analytics is blocked
        }
    }
}

/**
 * Track page views with custom properties
 * @param {string} path - The page path
 */
export function trackPageView(path) {
    trackEvent('pageview', { path });
}

/**
 * Initialize Vercel Analytics and page tracking
 */
export function initAnalytics() {
    // Inject Vercel Web Analytics script
    try {
        injectVercelAnalytics({
            beforeSend: (event) => {
                if (!isAnalyticsEnabled()) return null;
                return event;
            },
        });
    } catch (e) {
        console.warn('[Vercel Analytics] Failed to initialize:', e);
    }

    if (!isAnalyticsEnabled()) return;

    // Track initial page view
    trackPageView(window.location.pathname);
}
