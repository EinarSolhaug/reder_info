/**
 * Alert Replacement Helper
 * Provides a drop-in replacement for alert(), confirm(), and prompt() that uses the notification system
 * This ensures all alerts are translated and use the modern notification UI
 */

(function() {
    'use strict';
    
    // Store original functions
    const originalAlert = window.alert;
    const originalConfirm = window.confirm;
    const originalPrompt = window.prompt;
    
    /**
     * Replace alert() with notification system
     */
    window.alert = function(message) {
        if (window.MessageSystem) {
            window.MessageSystem.info(message || '', {
                title: window.TranslationHelper ? window.TranslationHelper.translate('Information') : 'Information',
                persistent: true,
                action: {
                    label: window.TranslationHelper ? window.TranslationHelper.translate('OK') : 'OK',
                    callback: function() {}
                }
            });
        } else {
            // Fallback to original alert if message system not available
            return originalAlert(message);
        }
    };
    
    /**
     * Replace confirm() with notification system
     * Returns a Promise that resolves to true/false
     */
    window.confirm = function(message) {
        // Use MessageRouter if available (better confirmation UI)
        if (window.MessageRouter) {
            return window.MessageRouter.confirm(message, {
                type: 'warning',
                persistent: true
            });
        }
        
        // Fallback to MessageSystem
        return new Promise(function(resolve) {
            if (window.MessageSystem) {
                window.MessageSystem.warning(message || '', {
                    title: window.TranslationHelper ? window.TranslationHelper.translate('Confirmation') : 'Confirmation',
                    persistent: true,
                    action: {
                        label: window.TranslationHelper ? window.TranslationHelper.translate('Yes') : 'Yes',
                        callback: function() {
                            resolve(true);
                        }
                    },
                    onClose: function() {
                        resolve(false);
                    }
                });
            } else {
                // Fallback to original confirm if message system not available
                resolve(originalConfirm(message));
            }
        });
    };
    
    /**
     * Helper to use confirm() in async/await context
     */
    window.confirmAsync = async function(message) {
        return await window.confirm(message);
    };
    
    /**
     * Replace prompt() with a custom modal (simplified version)
     * Note: Full prompt replacement would require a modal component
     */
    window.prompt = function(message, defaultValue) {
        // For now, fall back to original prompt
        // A full implementation would require a modal dialog component
        console.warn('prompt() replacement not fully implemented, using original');
        return originalPrompt(message, defaultValue);
    };
    
    // Export for testing
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = {
            originalAlert: originalAlert,
            originalConfirm: originalConfirm,
            originalPrompt: originalPrompt
        };
    }
})();

