# coupon-management-system


This project implements a simple Coupon Management system for an e-commerce use case.  
It exposes APIs to create coupons with eligibility rules and to fetch the best applicable coupon for a given user + cart.

## 1. Project Overview

- **Create Coupon API** to store coupons with various eligibility conditions.
- **Best Coupon API** that, given a user context and a cart, returns the best matching coupon (or none).
- In-memory storage is used, so no external database is required.

## 2. Tech Stack

- **Language:** JavaScript (Node.js)
- **Framework:** Express.js
- **Runtime:** Node.js 18+ recommended

## 3. How to Run

### Prerequisites

- Node.js (>= 18)
- npm (comes with Node.js)

### Setup

```bash
# Install dependencies
npm install
```

### Start the Service

```bash
# Production mode
npm start

# or development with auto-restart (if you install nodemon globally)
npm run dev
```

The service will start on `http://localhost:3000`.

### Example API Payloads

#### 3.1 Create Coupon API

**Endpoint:** `POST /coupons`  
**Body example:**

```json
{
  "code": "WELCOME100",
  "description": "₹100 off for new users",
  "discountType": "FLAT",
  "discountValue": 100,
  "maxDiscountAmount": null,
  "startDate": "2025-01-01T00:00:00.000Z",
  "endDate": "2025-12-31T23:59:59.000Z",
  "usageLimitPerUser": 1,
  "eligibility": {
    "allowedUserTiers": ["NEW"],
    "minLifetimeSpend": 0,
    "minOrdersPlaced": 0,
    "firstOrderOnly": true,
    "allowedCountries": ["IN"],
    "minCartValue": 500,
    "applicableCategories": ["electronics", "fashion"],
    "excludedCategories": [],
    "minItemsCount": 1
  }
}
```

#### 3.2 Best Coupon API

**Endpoint:** `POST /best-coupon`  
**Body example:**

```json
{
  "user": {
    "userId": "u123",
    "userTier": "NEW",
    "country": "IN",
    "lifetimeSpend": 1200,
    "ordersPlaced": 0
  },
  "cart": {
    "items": [
      {
        "productId": "p1",
        "category": "electronics",
        "unitPrice": 1500,
        "quantity": 1
      },
      {
        "productId": "p2",
        "category": "fashion",
        "unitPrice": 500,
        "quantity": 2
      }
    ]
  }
}
```

**Sample response:**

```json
{
  "bestCoupon": {
    "code": "WELCOME100",
    "description": "₹100 off for new users",
    "discountType": "FLAT",
    "discountValue": 100,
    "maxDiscountAmount": null,
    "startDate": "2025-01-01T00:00:00.000Z",
    "endDate": "2025-12-31T23:59:59.000Z",
    "usageLimitPerUser": 1,
    "eligibility": {
      "allowedUserTiers": ["NEW"],
      "minLifetimeSpend": 0,
      "minOrdersPlaced": 0,
      "firstOrderOnly": true,
      "allowedCountries": ["IN"],
      "minCartValue": 500,
      "applicableCategories": ["electronics", "fashion"],
      "excludedCategories": [],
      "minItemsCount": 1
    }
  },
  "discountAmount": 100,
  "finalPrice": 2400
}
```

If no coupon applies, the API returns:

```json
{
  "bestCoupon": null,
  "discountAmount": 0,
  "finalPrice": 2500
}
```

> Note: `finalPrice` is computed as `cartValue - discountAmount`.

## 4. How Best Coupon is Selected

1. Filter coupons that:
   - Are within the validity window: `startDate <= now <= endDate`.
   - Have not exceeded `usageLimitPerUser` for the given user.
   - Satisfy all eligibility criteria (user and cart attributes).

2. For each eligible coupon, compute the discount:
   - `FLAT`: `discount = discountValue`.
   - `PERCENT`: `discount = discountValue% of cartValue`,  
     capped by `maxDiscountAmount` if provided.

3. Choose the **best coupon** using this deterministic rule:
   1. Highest `discount` amount.
   2. If tie, earliest `endDate`.
   3. If still tie, lexicographically smaller `code`.

4. Return the best coupon and its computed discount.


