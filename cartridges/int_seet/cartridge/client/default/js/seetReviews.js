'use strict';

var reviews = require('./seetReviews/reviews');

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reviews.init);
} else {
    reviews.init();
}
