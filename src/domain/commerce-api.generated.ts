// Generated from Python OpenAPI by npm run contract:generate. Do not edit.
export interface paths {
  '/api/v1/cart': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Cart */
    get: operations['cart_api_v1_cart_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/cart/items': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Add Item */
    post: operations['add_item_api_v1_cart_items_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/cart/items/{item_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    post?: never
    /** Delete Item */
    delete: operations['delete_item_api_v1_cart_items__item_id__delete']
    options?: never
    head?: never
    /** Patch Item */
    patch: operations['patch_item_api_v1_cart_items__item_id__patch']
    trace?: never
  }
  '/api/v1/catalog/products': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Products */
    get: operations['products_api_v1_catalog_products_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/catalog/products/{handle}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Product */
    get: operations['product_api_v1_catalog_products__handle__get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/checkout/create-order': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Checkout */
    post: operations['checkout_api_v1_checkout_create_order_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/checkout/preview': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Preview */
    post: operations['preview_api_v1_checkout_preview_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/orders/{order_id}': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Get Order */
    get: operations['get_order_api_v1_orders__order_id__get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/orders/{order_id}/cancel': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Cancel */
    post: operations['cancel_api_v1_orders__order_id__cancel_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/api/v1/payments/session': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    get?: never
    put?: never
    /** Payment */
    post: operations['payment_api_v1_payments_session_post']
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
  '/health': {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    /** Health */
    get: operations['health_health_get']
    put?: never
    post?: never
    delete?: never
    options?: never
    head?: never
    patch?: never
    trace?: never
  }
}
export interface components {
  schemas: {
    /** AddItem */
    AddItem: {
      /** Quantity */
      quantity: number
      /**
       * Variant Id
       * Format: uuid
       */
      variant_id: string
    }
    /** CartItemResponse */
    CartItemResponse: {
      /** Available */
      available: number
      /** Color */
      color: string
      /** Id */
      id: string
      /** Quantity */
      quantity: number
      /** Sellable */
      sellable: boolean
      /** Size */
      size: number
      /** Sku */
      sku: string
      /** Subtotal */
      subtotal: string
      /** Title */
      title: string
      /** Unit Price */
      unit_price: string
      /** Variant Id */
      variant_id: string
    }
    /** CartResponse */
    CartResponse: {
      /** Currency */
      currency: string
      /** Items */
      items: components['schemas']['CartItemResponse'][]
      /** Total */
      total: string
    }
    /** ErrorResponse */
    ErrorResponse: {
      /** Code */
      code: string
      /** Detail */
      detail: string
    }
    /** HealthResponse */
    HealthResponse: {
      /**
       * Payment Enabled
       * @constant
       */
      payment_enabled: false
      /**
       * Status
       * @constant
       */
      status: 'ok'
    }
    /** MediaResponse */
    MediaResponse: {
      /** Color */
      color: string | null
      /** Url */
      url: string
    }
    /** OrderItemResponse */
    OrderItemResponse: {
      /** Color */
      color: string
      /** Id */
      id: string
      /** Quantity */
      quantity: number
      /** Size */
      size: number
      /** Sku */
      sku: string
      /** Title */
      title: string
      /** Unit Price */
      unit_price: string
      /** Variant Id */
      variant_id: string
    }
    /** OrderResponse */
    OrderResponse: {
      /** Cancellation Reason */
      cancellation_reason: ('expired' | 'customer_cancelled') | null
      /** Currency */
      currency: string
      /** Expires At */
      expires_at: string | null
      /** Id */
      id: string
      /** Items */
      items: components['schemas']['OrderItemResponse'][]
      /** Message */
      message: string
      /**
       * Payment Enabled
       * @constant
       */
      payment_enabled: false
      /**
       * Status
       * @enum {string}
       */
      status: 'pending_payment' | 'cancelled'
      /** Total */
      total: string
    }
    /** PaymentRequest */
    PaymentRequest: {
      /**
       * Order Id
       * Format: uuid
       */
      order_id: string
    }
    /** PaymentResponse */
    PaymentResponse: {
      /**
       * Charged
       * @constant
       */
      charged: false
      /**
       * Code
       * @constant
       */
      code: 'payment_disabled'
      /** Message */
      message: string
      /** Order Id */
      order_id: string
      /**
       * Order Status
       * @enum {string}
       */
      order_status: 'pending_payment' | 'cancelled'
      /**
       * Payment Enabled
       * @constant
       */
      payment_enabled: false
      /**
       * Provider
       * @constant
       */
      provider: 'mock'
    }
    /** ProductResponse */
    ProductResponse: {
      /** Description */
      description: string
      /** Handle */
      handle: string
      /** Id */
      id: string
      /** Media */
      media: components['schemas']['MediaResponse'][]
      /** Title */
      title: string
      /** Variants */
      variants: components['schemas']['VariantResponse'][]
    }
    /** Quantity */
    Quantity: {
      /** Quantity */
      quantity: number
    }
    /** VariantResponse */
    VariantResponse: {
      /** Available */
      available: number
      /** Color */
      color: string
      /** Color Hex */
      color_hex: string
      /** Currency */
      currency: string
      /** Id */
      id: string
      /** Price */
      price: string
      /** Size */
      size: number
      /** Sku */
      sku: string
    }
  }
  responses: never
  parameters: never
  requestBodies: never
  headers: never
  pathItems: never
}
export interface operations {
  cart_api_v1_cart_get: {
    parameters: {
      query?: never
      header: {
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CartResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  add_item_api_v1_cart_items_post: {
    parameters: {
      query?: never
      header: {
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['AddItem']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CartResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  delete_item_api_v1_cart_items__item_id__delete: {
    parameters: {
      query?: never
      header: {
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path: {
        item_id: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CartResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  patch_item_api_v1_cart_items__item_id__patch: {
    parameters: {
      query?: never
      header: {
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path: {
        item_id: string
      }
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['Quantity']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CartResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  products_api_v1_catalog_products_get: {
    parameters: {
      query?: never
      header?: {
        'x-internal-proxy-secret'?: string | null
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProductResponse'][]
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  product_api_v1_catalog_products__handle__get: {
    parameters: {
      query?: never
      header?: {
        'x-internal-proxy-secret'?: string | null
      }
      path: {
        handle: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ProductResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  checkout_api_v1_checkout_create_order_post: {
    parameters: {
      query?: never
      header: {
        'idempotency-key': string
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['OrderResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  preview_api_v1_checkout_preview_post: {
    parameters: {
      query?: never
      header: {
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['CartResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  get_order_api_v1_orders__order_id__get: {
    parameters: {
      query?: never
      header: {
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path: {
        order_id: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['OrderResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  cancel_api_v1_orders__order_id__cancel_post: {
    parameters: {
      query?: never
      header: {
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path: {
        order_id: string
      }
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['OrderResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  payment_api_v1_payments_session_post: {
    parameters: {
      query?: never
      header: {
        'x-internal-proxy-secret'?: string | null
        'x-session-id': string
      }
      path?: never
      cookie?: never
    }
    requestBody: {
      content: {
        'application/json': components['schemas']['PaymentRequest']
      }
    }
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['PaymentResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
  health_health_get: {
    parameters: {
      query?: never
      header?: never
      path?: never
      cookie?: never
    }
    requestBody?: never
    responses: {
      /** @description Successful Response */
      200: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['HealthResponse']
        }
      }
      /** @description Bad Request */
      400: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unauthorized */
      401: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Forbidden */
      403: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Not Found */
      404: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Method Not Allowed */
      405: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Conflict */
      409: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Unprocessable Entity */
      422: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Internal Server Error */
      500: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
      /** @description Service Unavailable */
      503: {
        headers: {
          [name: string]: unknown
        }
        content: {
          'application/json': components['schemas']['ErrorResponse']
        }
      }
    }
  }
}
