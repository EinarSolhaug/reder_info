/**
 * Theme Manager - Universal Theme Color Management System
 * 
 * This module handles all theme color operations across the entire application.
 * It ensures consistent color application on all HTML pages.
 * 
 * Features:
 * - Loads theme colors from server on page load
 * - Applies colors to CSS variables immediately
 * - Listens for theme changes and applies them dynamically
 * - Works with Settings page color pickers
 * - Persists colors across page reloads
 */

(function() {
    'use strict';

    // Default theme colors (fallback if server doesn't provide)
    const DEFAULT_THEME_COLORS = {
        // Primary Colors
        'primary-color': '#4f46e5',
        'secondary-color': '#06b6d4',
        'success-color': '#10b981',
        'danger-color': '#ef4444',
        'warning-color': '#f59e0b',
        'info-color': '#3b82f6',
        
        // Background Colors
        'bg-light': '#f8fafc',
        'bg-white': '#ffffff',
        'bg-dark': '#1e293b',
        'bg-card': '#ffffff',
        'bg-section': '#f8fafc',
        
        // Text Colors
        'text-dark': '#1e293b',
        'text-light': '#64748b',
        'text-muted': '#94a3b8',
        'text-white': '#ffffff',
        'text-heading': '#0f172a',
        
        // Sidebar Colors
        'sidebar-bg': '#1e293b',
        'sidebar-text': '#e2e8f0',
        'sidebar-active': '#4f46e5',
        'sidebar-hover': '#334155',
        'sidebar-border': '#334155',
        
        // Button Colors
        'btn-primary': '#4f46e5',
        'btn-primary-hover': '#4338ca',
        'btn-secondary': '#06b6d4',
        'btn-secondary-hover': '#0891b2',
        'btn-success': '#10b981',
        'btn-success-hover': '#059669',
        'btn-danger': '#ef4444',
        'btn-danger-hover': '#dc2626',
        'btn-warning': '#f59e0b',
        'btn-warning-hover': '#d97706',
        'btn-outline-border': '#4f46e5',
        
        // Section & Card Colors
        'section-bg': '#ffffff',
        'section-border': '#e2e8f0',
        'card-bg': '#ffffff',
        'card-border': '#e2e8f0',
        'card-header-bg': '#f8fafc',
        
        // Border Colors
        'border-color': '#e2e8f0',
        'border-light': '#f1f5f9',
        'border-dark': '#cbd5e1',
        
        // Link Colors
        'link-color': '#4f46e5',
        'link-hover': '#4338ca',
        
        // Alert Colors
        'alert-success-bg': '#d1fae5',
        'alert-success-text': '#065f46',
        'alert-danger-bg': '#fee2e2',
        'alert-danger-text': '#991b1b',
        'alert-warning-bg': '#fef3c7',
        'alert-warning-text': '#92400e',
        'alert-info-bg': '#dbeafe',
        'alert-info-text': '#1e40af',
        
        // Table Colors
        'table-header-bg': '#f8fafc',
        'table-header-text': '#1e293b',
        'table-row-bg': '#ffffff',
        'table-row-hover': '#f8fafc',
        'table-border': '#e2e8f0',
        
        // Form Colors
        'input-bg': '#ffffff',
        'input-border': '#e2e8f0',
        'input-focus': '#4f46e5',
        'input-text': '#1e293b',
        
        // Chart Colors (palette)
        'chart-color-1': '#667eea',
        'chart-color-2': '#764ba2',
        'chart-color-3': '#10b981',
        'chart-color-4': '#f59e0b',
        'chart-color-5': '#ef4444',
        'chart-color-6': '#06b6d4',
        'chart-color-7': '#8b5cf6',
        'chart-color-8': '#ec4899',
        'chart-color-9': '#f97316',
        'chart-color-10': '#14b8a6',
        
        // Gradient Colors
        'gradient-start': '#4f46e5',
        'gradient-end': '#06b6d4',
        'gradient-direction': '135deg'
    };

    // CSS variable mapping (settings key -> CSS variable name)
    const CSS_VAR_MAP = {
        // Primary Colors
        'primary_color': 'primary-color',
        'secondary_color': 'secondary-color',
        'success_color': 'success-color',
        'danger_color': 'danger-color',
        'warning_color': 'warning-color',
        'info_color': 'info-color',
        
        // Background Colors
        'bg_light': 'bg-light',
        'bg_white': 'bg-white',
        'bg_dark': 'bg-dark',
        'bg_card': 'bg-card',
        'bg_section': 'bg-section',
        
        // Text Colors
        'text_dark': 'text-dark',
        'text_light': 'text-light',
        'text_muted': 'text-muted',
        'text_white': 'text-white',
        'text_heading': 'text-heading',
        
        // Sidebar Colors
        'sidebar_bg': 'sidebar-bg',
        'sidebar_text': 'sidebar-text',
        'sidebar_active': 'sidebar-active',
        'sidebar_hover': 'sidebar-hover',
        'sidebar_border': 'sidebar-border',
        
        // Button Colors
        'btn_primary': 'btn-primary',
        'btn_primary_hover': 'btn-primary-hover',
        'btn_secondary': 'btn-secondary',
        'btn_secondary_hover': 'btn-secondary-hover',
        'btn_success': 'btn-success',
        'btn_success_hover': 'btn-success-hover',
        'btn_danger': 'btn-danger',
        'btn_danger_hover': 'btn-danger-hover',
        'btn_warning': 'btn-warning',
        'btn_warning_hover': 'btn-warning-hover',
        'btn_outline_border': 'btn-outline-border',
        
        // Section & Card Colors
        'section_bg': 'section-bg',
        'section_border': 'section-border',
        'card_bg': 'card-bg',
        'card_border': 'card-border',
        'card_header_bg': 'card-header-bg',
        
        // Border Colors
        'border_color': 'border-color',
        'border_light': 'border-light',
        'border_dark': 'border-dark',
        
        // Link Colors
        'link_color': 'link-color',
        'link_hover': 'link-hover',
        
        // Alert Colors
        'alert_success_bg': 'alert-success-bg',
        'alert_success_text': 'alert-success-text',
        'alert_danger_bg': 'alert-danger-bg',
        'alert_danger_text': 'alert-danger-text',
        'alert_warning_bg': 'alert-warning-bg',
        'alert_warning_text': 'alert-warning-text',
        'alert_info_bg': 'alert-info-bg',
        'alert_info_text': 'alert-info-text',
        
        // Table Colors
        'table_header_bg': 'table-header-bg',
        'table_header_text': 'table-header-text',
        'table_row_bg': 'table-row-bg',
        'table_row_hover': 'table-row-hover',
        'table_border': 'table-border',
        
        // Form Colors
        'input_bg': 'input-bg',
        'input_border': 'input-border',
        'input_focus': 'input-focus',
        'input_text': 'input-text',
        
        // Chart Colors
        'chart_color_1': 'chart-color-1',
        'chart_color_2': 'chart-color-2',
        'chart_color_3': 'chart-color-3',
        'chart_color_4': 'chart-color-4',
        'chart_color_5': 'chart-color-5',
        'chart_color_6': 'chart-color-6',
        'chart_color_7': 'chart-color-7',
        'chart_color_8': 'chart-color-8',
        'chart_color_9': 'chart-color-9',
        'chart_color_10': 'chart-color-10',
        
        // Gradient Colors
        'gradient_start': 'gradient-start',
        'gradient_end': 'gradient-end',
        'gradient_direction': 'gradient-direction'
    };

    /**
     * Theme Manager Class
     */
    class ThemeManager {
        constructor() {
            this.colors = {};
            this.initialized = false;
            this.init();
        }

        /**
         * Initialize theme manager
         */
        init() {
            if (this.initialized) return;
            
            // Load theme colors from server
            this.loadThemeColors();
            
            // Listen for theme color changes
            this.setupEventListeners();
            
            this.initialized = true;
        }

        /**
         * Load theme colors from server
         */
        async loadThemeColors() {
            try {
                // Try to get theme colors from server
                const response = await fetch('/api/settings/theme');
                if (response.ok) {
                    const data = await response.json();
                    if (data.success && data.theme) {
                        this.colors = data.theme;
                        this.applyAllColors();
                        return;
                    }
                }
            } catch (error) {
                console.warn('Could not load theme colors from server, using defaults:', error);
            }

            // Fallback: Try to get from inline script data (set by base.html)
            if (window.INITIAL_THEME_COLORS) {
                this.colors = window.INITIAL_THEME_COLORS;
                this.applyAllColors();
                return;
            }

            // Final fallback: Use defaults
            this.colors = {};
            this.applyDefaults();
        }

        /**
         * Apply default colors
         */
        applyDefaults() {
            Object.entries(DEFAULT_THEME_COLORS).forEach(([cssVar, color]) => {
                this.applyColor(cssVar, color);
            });
        }

        /**
         * Apply a single color to CSS variable
         * @param {string} cssVar - CSS variable name (e.g., 'primary-color')
         * @param {string} color - Color value (e.g., '#4f46e5')
         */
        applyColor(cssVar, color) {
            if (!cssVar || !color) return;
            
            // Handle gradient direction (not a color)
            if (cssVar === 'gradient-direction') {
                document.documentElement.style.setProperty(`--${cssVar}`, color);
                this.updateGradient();
                return;
            }
            
            // Normalize color value
            if (!color.startsWith('#') && !color.startsWith('rgb') && !color.startsWith('rgba')) {
                color = '#' + color;
            }
            
            // Apply to root element
            document.documentElement.style.setProperty(`--${cssVar}`, color);
            
            // If this is a gradient color, update the gradient
            if (cssVar === 'gradient-start' || cssVar === 'gradient-end') {
                this.updateGradient();
            }
        }
        
        /**
         * Update gradient background based on gradient colors and direction
         */
        updateGradient() {
            const start = this.getColorValue('gradient-start') || DEFAULT_THEME_COLORS['gradient-start'];
            const end = this.getColorValue('gradient-end') || DEFAULT_THEME_COLORS['gradient-end'];
            const direction = this.getColorValue('gradient-direction') || DEFAULT_THEME_COLORS['gradient-direction'];
            
            const gradient = `linear-gradient(${direction}, ${start} 0%, ${end} 100%)`;
            document.documentElement.style.setProperty('--gradient-bg', gradient);
            
            // Dispatch event for gradient update
            document.dispatchEvent(new CustomEvent('themeGradientChanged', {
                detail: { start, end, direction, gradient }
            }));
        }
        
        /**
         * Get color value from CSS variable or return default
         * @param {string} cssVar - CSS variable name
         * @returns {string} Color value
         */
        getColorValue(cssVar) {
            const computed = getComputedStyle(document.documentElement).getPropertyValue(`--${cssVar}`);
            return computed ? computed.trim() : null;
        }

        /**
         * Apply all loaded colors to CSS variables
         */
        applyAllColors() {
            Object.entries(this.colors).forEach(([settingKey, color]) => {
                const cssVar = CSS_VAR_MAP[settingKey];
                if (cssVar && color) {
                    this.applyColor(cssVar, color);
                }
            });
            
            // Update gradient after all colors are applied
            this.updateGradient();
        }

        /**
         * Update a theme color
         * @param {string} settingKey - Setting key (e.g., 'primary_color')
         * @param {string} color - Color value
         */
        updateColor(settingKey, color) {
            const cssVar = CSS_VAR_MAP[settingKey];
            if (cssVar) {
                this.colors[settingKey] = color;
                this.applyColor(cssVar, color);
                
                // Dispatch event for other components
                document.dispatchEvent(new CustomEvent('themeColorChanged', {
                    detail: { settingKey, cssVar, color }
                }));
            }
        }

        /**
         * Update multiple colors at once
         * @param {Object} colors - Object with setting keys and color values
         */
        updateColors(colors) {
            Object.entries(colors).forEach(([settingKey, color]) => {
                this.updateColor(settingKey, color);
            });
        }

        /**
         * Get current color value
         * @param {string} settingKey - Setting key
         * @returns {string|null} Color value or null
         */
        getColor(settingKey) {
            return this.colors[settingKey] || null;
        }

        /**
         * Get all current colors
         * @returns {Object} Object with all color values
         */
        getAllColors() {
            return { ...this.colors };
        }

        /**
         * Reset all colors to defaults
         */
        resetToDefaults() {
            this.colors = {};
            this.applyDefaults();
            
            // Dispatch event
            document.dispatchEvent(new CustomEvent('themeColorsReset', {
                detail: { colors: DEFAULT_THEME_COLORS }
            }));
        }

        /**
         * Setup event listeners for theme changes
         */
        setupEventListeners() {
            // Listen for theme color updates from Settings page
            document.addEventListener('themeColorUpdate', (event) => {
                if (event.detail && event.detail.settingKey && event.detail.color) {
                    this.updateColor(event.detail.settingKey, event.detail.color);
                }
            });

            // Listen for bulk theme color updates
            document.addEventListener('themeColorsUpdate', (event) => {
                if (event.detail && event.detail.colors) {
                    this.updateColors(event.detail.colors);
                }
            });

            // Listen for theme reset
            document.addEventListener('themeColorsReset', () => {
                this.resetToDefaults();
            });

            // Listen for storage changes (in case settings are updated in another tab)
            window.addEventListener('storage', (event) => {
                if (event.key === 'themeColors') {
                    try {
                        const colors = JSON.parse(event.newValue);
                        if (colors) {
                            this.updateColors(colors);
                        }
                    } catch (e) {
                        console.warn('Error parsing theme colors from storage:', e);
                    }
                }
            });
        }
    }

    // Create global theme manager instance
    window.ThemeManager = new ThemeManager();

    // Also expose as window.themeManager for convenience
    window.themeManager = window.ThemeManager;

    // Apply theme colors immediately (before DOMContentLoaded)
    // This prevents flash of unstyled content
    if (document.readyState === 'loading') {
        // If we have initial colors from server, apply them immediately
        if (window.INITIAL_THEME_COLORS) {
            const manager = window.ThemeManager;
            Object.entries(window.INITIAL_THEME_COLORS).forEach(([settingKey, color]) => {
                const cssVar = CSS_VAR_MAP[settingKey];
                if (cssVar && color) {
                    manager.applyColor(cssVar, color);
                }
            });
        }
    }

    // Ensure colors are applied on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function() {
        window.ThemeManager.loadThemeColors();
    });

    // Re-apply colors if page becomes visible (handles tab switching)
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) {
            window.ThemeManager.loadThemeColors();
        }
    });

    console.log('✅ Theme Manager initialized - Colors will be applied consistently across all pages');
})();

