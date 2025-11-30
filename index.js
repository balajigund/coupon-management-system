const express = require('express');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-memory storage
const coupons = [];
// usageData maps couponCode -> { userId -> count }
const usageData = {};

// Utility: compute cart value
function computeCartValue(cart) {
  if (!cart || !Array.isArray(cart.items)) return 0;
  return cart.items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    return sum + qty * price;
  }, 0);
}

// Utility: compute total items count
function computeItemsCount(cart) {
  if (!cart || !Array.isArray(cart.items)) return 0;
  return cart.items.reduce((sum, item) => {
    const qty = Number(item.quantity) || 0;
    return sum + qty;
  }, 0);
}

// Utility: get unique categories in cart
function getCartCategories(cart) {
  if (!cart || !Array.isArray(cart.items)) return [];
  const set = new Set();
  cart.items.forEach(item => {
    if (item.category) set.add(item.category);
  });
  return Array.from(set);
}

// Check if coupon is within valid date range
function isWithinDateRange(coupon, now) {
  try {
    const start = new Date(coupon.startDate);
    const end = new Date(coupon.endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return false;
    }
    return start <= now && now <= end;
  } catch (e) {
    return false;
  }
}

// Check usage limit for a user
function isUnderUsageLimit(coupon, userId) {
  if (coupon.usageLimitPerUser == null) return true;
  const code = coupon.code;
  if (!usageData[code] || !usageData[code][userId]) return true;
  return usageData[code][userId] < coupon.usageLimitPerUser;
}

// Evaluate eligibility object
function isEligible(coupon, user, cart, cartValue) {
  const eligibility = coupon.eligibility || {};
  const cartCategories = getCartCategories(cart);
  const itemsCount = computeItemsCount(cart);

  // User-based attributes
  if (eligibility.allowedUserTiers && eligibility.allowedUserTiers.length > 0) {
    if (!eligibility.allowedUserTiers.includes(user.userTier)) return false;
  }

  if (eligibility.minLifetimeSpend != null) {
    if ((user.lifetimeSpend || 0) < eligibility.minLifetimeSpend) return false;
  }

  if (eligibility.minOrdersPlaced != null) {
    if ((user.ordersPlaced || 0) < eligibility.minOrdersPlaced) return false;
  }

  if (eligibility.firstOrderOnly === true) {
    if ((user.ordersPlaced || 0) !== 0 && (user.ordersPlaced || 0) !== 1) {
      // Problem statement is a bit ambiguous; assuming:
      // firstOrderOnly = true -> valid if this is user's first order.
      // We interpret ordersPlaced as completed orders before this one.
      // So if ordersPlaced > 0 => not eligible.
    }
    if ((user.ordersPlaced || 0) > 0) return false;
  }

  if (eligibility.allowedCountries && eligibility.allowedCountries.length > 0) {
    if (!eligibility.allowedCountries.includes(user.country)) return false;
  }

  // Cart-based attributes
  if (eligibility.minCartValue != null) {
    if (cartValue < eligibility.minCartValue) return false;
  }

  if (eligibility.applicableCategories && eligibility.applicableCategories.length > 0) {
    const hasApplicable = cartCategories.some(cat =>
      eligibility.applicableCategories.includes(cat)
    );
    if (!hasApplicable) return false;
  }

  if (eligibility.excludedCategories && eligibility.excludedCategories.length > 0) {
    const hasExcluded = cartCategories.some(cat =>
      eligibility.excludedCategories.includes(cat)
    );
    if (hasExcluded) return false;
  }

  if (eligibility.minItemsCount != null) {
    if (itemsCount < eligibility.minItemsCount) return false;
  }

  return true;
}

// Compute discount for a coupon
function computeDiscount(coupon, cartValue) {
  if (cartValue <= 0) return 0;
  const type = coupon.discountType;
  const value = Number(coupon.discountValue) || 0;
  let discount = 0;

  if (type === 'FLAT') {
    discount = value;
  } else if (type === 'PERCENT') {
    discount = (cartValue * value) / 100;
    if (coupon.maxDiscountAmount != null) {
      discount = Math.min(discount, coupon.maxDiscountAmount);
    }
  } else {
    discount = 0;
  }

  // Do not allow discount more than cart value
  if (discount > cartValue) discount = cartValue;
  if (discount < 0) discount = 0;
  return discount;
}

// Create Coupon API
app.post('/coupons', (req, res) => {
  const coupon = req.body;

  if (!coupon || !coupon.code) {
    return res.status(400).json({ error: 'Coupon code is required' });
  }

  // Ensure unique code: reject duplicates
  const existing = coupons.find(c => c.code === coupon.code);
  if (existing) {
    return res.status(409).json({ error: 'Coupon code already exists' });
  }

  // Basic validation of required fields
  if (!coupon.description) {
    return res.status(400).json({ error: 'description is required' });
  }
  if (!coupon.discountType || !['FLAT', 'PERCENT'].includes(coupon.discountType)) {
    return res.status(400).json({ error: 'discountType must be FLAT or PERCENT' });
  }
  if (coupon.discountValue == null || isNaN(Number(coupon.discountValue))) {
    return res.status(400).json({ error: 'discountValue must be a number' });
  }
  if (!coupon.startDate || !coupon.endDate) {
    return res.status(400).json({ error: 'startDate and endDate are required' });
  }

  coupons.push(coupon);
  return res.status(201).json({ message: 'Coupon created', coupon });
});

// Optional: list coupons
app.get('/coupons', (req, res) => {
  res.json({ coupons });
});

// Best Coupon API
app.post('/best-coupon', (req, res) => {
  const { user, cart } = req.body || {};
  if (!user || !user.userId) {
    return res.status(400).json({ error: 'user with userId is required' });
  }
  if (!cart || !Array.isArray(cart.items)) {
    return res.status(400).json({ error: 'cart with items array is required' });
  }

  const now = new Date();
  const cartValue = computeCartValue(cart);

  let best = null;

  coupons.forEach(coupon => {
    if (!isWithinDateRange(coupon, now)) return;
    if (!isUnderUsageLimit(coupon, user.userId)) return;
    if (!isEligible(coupon, user, cart, cartValue)) return;

    const discount = computeDiscount(coupon, cartValue);

    if (!best) {
      best = { coupon, discount };
      return;
    }

    // Compare with current best
    if (discount > best.discount) {
      best = { coupon, discount };
      return;
    }

    if (discount === best.discount) {
      // Tie-breaker 1: earliest endDate
      const bestEnd = new Date(best.coupon.endDate);
      const currEnd = new Date(coupon.endDate);
      if (currEnd < bestEnd) {
        best = { coupon, discount };
        return;
      }
      if (currEnd.getTime() === bestEnd.getTime()) {
        // Tie-breaker 2: lexicographically smaller code
        if (coupon.code < best.coupon.code) {
          best = { coupon, discount };
        }
      }
    }
  });

  if (!best) {
    return res.json({
      bestCoupon: null,
      discountAmount: 0,
      finalPrice: cartValue
    });
  }

  // Update usage data for the selected coupon
  const selectedCode = best.coupon.code;
  usageData[selectedCode] = usageData[selectedCode] || {};
  usageData[selectedCode][user.userId] = (usageData[selectedCode][user.userId] || 0) + 1;

  return res.json({
    bestCoupon: best.coupon,
    discountAmount: best.discount,
    finalPrice: cartValue - best.discount
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Coupon Management API is running'
  });
});

app.listen(PORT, () => {
  console.log(`Coupon Management service listening on port ${PORT}`);
});