/**
 * Delta Paper Trading - Validation Module
 * Comprehensive input validation utilities
 */

class InputValidator {
  constructor(config) {
    this.config = config;
    this.limits = config.VALIDATION;
  }

  /**
   * Validate lot quantity input
   * @param {*} value - Input value to validate
   * @param {string} symbol - Trading symbol (BTCUSD, ETHUSD, SOLUSD)
   * @returns {Object} Validation result with isValid, value, and error
   */
  validateLots(value, symbol = null) {
    const result = {
      isValid: false,
      value: null,
      error: null,
      corrected: null
    };

    // Handle empty/null/undefined
    if (value === null || value === undefined || value === '') {
      result.error = 'Quantity required';
      result.corrected = this.limits.MIN_LOTS;
      return result;
    }

    // Convert to number
    let numValue = typeof value === 'string' ? parseFloat(value) : Number(value);

    // Check if valid number
    if (isNaN(numValue)) {
      result.error = 'Must be a number';
      result.corrected = this.limits.MIN_LOTS;
      return result;
    }

    // Round to integer (lots must be whole numbers)
    numValue = Math.round(numValue);

    // Check minimum
    if (numValue < this.limits.MIN_LOTS) {
      result.error = `Minimum ${this.limits.MIN_LOTS} lot`;
      result.corrected = this.limits.MIN_LOTS;
      result.value = this.limits.MIN_LOTS;
      result.isValid = true;
      return result;
    }

    // Check maximum
    if (numValue > this.limits.MAX_LOTS) {
      result.error = `Maximum ${this.limits.MAX_LOTS.toLocaleString()} lots`;
      result.corrected = this.limits.MAX_LOTS;
      result.value = this.limits.MAX_LOTS;
      result.isValid = true;
      return result;
    }

    // Valid
    result.value = numValue;
    result.isValid = true;
    return result;
  }

  /**
   * Validate deposit amount
   * @param {*} value - Input value
   * @returns {Object} Validation result
   */
  validateDeposit(value) {
    const result = {
      isValid: false,
      value: null,
      error: null
    };

    if (value === null || value === undefined || value === '') {
      result.error = 'Enter amount';
      return result;
    }

    let numValue = typeof value === 'string' ? parseFloat(value) : Number(value);

    if (isNaN(numValue)) {
      result.error = 'Invalid amount';
      return result;
    }

    if (numValue <= 0) {
      result.error = 'Amount must be positive';
      return result;
    }

    if (numValue < this.config.MIN_DEPOSIT) {
      result.error = `₹${this.config.MIN_DEPOSIT.toLocaleString()} minimum`;
      return result;
    }

    // Round to 2 decimals for INR
    result.value = Math.round(numValue * 100) / 100;
    result.isValid = true;
    return result;
  }

  /**
   * Validate withdrawal amount
   * @param {*} value - Input value
   * @param {number} availableBalance - Available balance to withdraw
   * @returns {Object} Validation result
   */
  validateWithdrawal(value, availableBalance) {
    const result = {
      isValid: false,
      value: null,
      error: null
    };

    if (value === null || value === undefined || value === '') {
      result.error = 'Enter amount';
      return result;
    }

    let numValue = typeof value === 'string' ? parseFloat(value) : Number(value);

    if (isNaN(numValue)) {
      result.error = 'Invalid amount';
      return result;
    }

    if (numValue <= 0) {
      result.error = 'Amount must be positive';
      return result;
    }

    if (numValue < this.config.MIN_WITHDRAW) {
      result.error = `₹${this.config.MIN_WITHDRAW.toLocaleString()} minimum`;
      return result;
    }

    if (numValue > availableBalance) {
      result.error = 'Insufficient balance';
      return result;
    }

    // Round to 2 decimals for INR
    result.value = Math.round(numValue * 100) / 100;
    result.isValid = true;
    return result;
  }

  /**
   * Validate currency conversion amount
   * @param {*} value - Input value
   * @param {number} availableBalance - Available balance in source currency
   * @param {string} fromCurrency - Source currency ('INR' or 'USD')
   * @returns {Object} Validation result
   */
  validateConversion(value, availableBalance, fromCurrency) {
    const result = {
      isValid: false,
      value: null,
      error: null
    };

    if (value === null || value === undefined || value === '') {
      result.error = 'Enter amount';
      return result;
    }

    let numValue = typeof value === 'string' ? parseFloat(value) : Number(value);

    if (isNaN(numValue)) {
      result.error = 'Invalid amount';
      return result;
    }

    if (numValue <= 0) {
      result.error = 'Amount must be positive';
      return result;
    }

    if (numValue > availableBalance) {
      result.error = `Insufficient ${fromCurrency} balance`;
      return result;
    }

    // Allow small amounts but warn about fees
    if (fromCurrency === 'INR' && numValue < 100) {
      result.warning = 'Small amount: fees may be significant';
    }

    // Round based on currency
    result.value = fromCurrency === 'INR' 
      ? Math.round(numValue * 100) / 100 
      : Math.round(numValue * 1000000) / 1000000;
    
    result.isValid = true;
    return result;
  }

  /**
   * Validate leverage value
   * @param {*} value - Input value
   * @returns {Object} Validation result
   */
  validateLeverage(value) {
    const result = {
      isValid: false,
      value: null,
      error: null
    };

    if (value === null || value === undefined || value === '') {
      result.error = 'Required';
      return result;
    }

    let numValue = typeof value === 'string' ? parseInt(value, 10) : Number(value);

    if (isNaN(numValue) || !Number.isInteger(numValue)) {
      result.error = 'Must be whole number';
      return result;
    }

    if (numValue < 1) {
      result.error = 'Minimum 1x';
      result.value = 1;
      result.isValid = true;
      return result;
    }

    if (numValue > this.config.MAX_LEVERAGE) {
      result.error = `Maximum ${this.config.MAX_LEVERAGE}x`;
      result.value = this.config.MAX_LEVERAGE;
      result.isValid = true;
      return result;
    }

    result.value = numValue;
    result.isValid = true;
    return result;
  }

  /**
   * Validate trader name
   * @param {*} value - Input value
   * @returns {Object} Validation result
   */
  validateName(value) {
    const result = {
      isValid: false,
      value: null,
      error: null
    };

    if (value === null || value === undefined || value === '') {
      result.error = 'Name required';
      return result;
    }

    if (typeof value !== 'string') {
      result.error = 'Must be text';
      return result;
    }

    const trimmed = value.trim();

    if (trimmed.length === 0) {
      result.error = 'Name cannot be empty';
      return result;
    }

    if (trimmed.length > 50) {
      result.error = 'Max 50 characters';
      result.value = trimmed.slice(0, 50);
      result.isValid = true;
      return result;
    }

    result.value = trimmed;
    result.isValid = true;
    return result;
  }

  /**
   * Sanitize string input for display (prevent XSS)
   * @param {string} str - Input string
   * @returns {string} Sanitized string
   */
  sanitize(str) {
    if (typeof str !== 'string') return String(str || '');
    
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  /**
   * Format number for display
   * @param {number} num - Number to format
   * @param {number} decimals - Decimal places
   * @param {string} prefix - Optional prefix (e.g., '$', '₹')
   * @returns {string} Formatted string
   */
  formatNumber(num, decimals = 2, prefix = '') {
    if (typeof num !== 'number' || isNaN(num)) {
      return prefix + '0';
    }

    const formatted = num.toLocaleString('en-IN', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });

    return prefix + formatted;
  }

  /**
   * Format currency (INR)
   * @param {number} amount - Amount in INR
   * @returns {string} Formatted currency string
   */
  formatINR(amount) {
    return this.formatNumber(amount, 0, '₹');
  }

  /**
   * Format USD amount
   * @param {number} amount - Amount in USD
   * @returns {string} Formatted currency string
   */
  formatUSD(amount) {
    return this.formatNumber(amount, 2, '$');
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { InputValidator };
}
