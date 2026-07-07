# Trackstar ↔ ShipHero Field Mapping

## Orders

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `id` | `order.id` | ShipHero GraphQL node ID |
| `warehouse_customer_id` | `order.account_id` | |
| `reference_id` | `order.partner_order_id` | Falls back to `order.id` |
| `order_number` | `order.order_number` | Falls back to `reference_id` |
| `created_date` | `order.order_date` | ISO 8601 |
| `updated_date` | `order.updated_at` | ISO 8601 |
| `status` | Derived from `order.fulfillment_status`, `order.holds.*`, line item pick/backorder state, and shipment presence | See status logic below |
| `raw_status` | `order.fulfillment_status` | |
| `channel` | `order.shop_name` or `order.source` | First non-null value |
| `type` | `order.fulfillment_status` | `"b2b"` if status is "b2b" or "wholesale", else `"d2c"` |
| `shipping_method` | `order.shipping_lines.method` | |
| `shipping_method_id` | `order.shipping_lines.method` | |
| `shipping_method_name` | `order.shipping_lines.title` | |
| `carrier_id` | `order.shipping_lines.carrier` | |
| `carrier_name` | `order.shipping_lines.carrier` | |
| `invoice_currency_code` | `order.currency` | Defaults to `"USD"` |
| `total_price` | `order.total_price` | |
| `total_tax` | `order.total_tax` | |
| `total_discount` | `order.total_discounts` | |
| `total_shipping` | `order.shipping_lines.price` | |
| `required_ship_date` | `order.required_ship_date` | ISO 8601 |
| `tags` | `order.tags` | |
| `is_third_party_freight` | `order.third_party_shipper.account_number` | `true` if account number present |
| `third_party_freight_account_number` | `order.third_party_shipper.account_number` | |
| `saturday_delivery` | `order.saturday_delivery` | |
| `signature_required` | `order.require_signature` | |
| `international_duty_paid_by` | `order.incoterms` | `"recipient"` if DDU, else `"sender"` |
| `warehouse_id` | `shipment.warehouse_id` | Set only if all shipments share the same warehouse |
| `external_system_url` | `order.legacy_id` | Constructed URL: `https://app.shiphero.com/dashboard/orders/details/{legacy_id}` |
| `trading_partner` | — | Not available |
| `service_level` | — | Not available |
| `scac` | — | Not available |

### Order Status Derivation (priority order)

1. `"fulfilled"` — if `fulfillment_status == "fulfilled"`
2. `"cancelled"` — if `fulfillment_status == "canceled"`
3. `"exception"` — if any hold flag is active (`address_hold`, `client_hold`, `fraud_hold`, `operator_hold`, `payment_hold`, `shipping_method_hold`)
4. `"backordered"` — if any line item has `backorder_quantity > 0`
5. `"partially_fulfilled"` — if any line item has `quantity_pending_fulfillment == 0` (but not all)
6. `"picked"` — if all line items are fully picked
7. `"open"` — if `fulfillment_status` is `"unfulfilled"`, `"default"`, or `"pending"`
8. Fallback: `"fulfilled"` if shipments exist, else `"open"`

### Ship-To Address

| Trackstar Field | ShipHero Field |
|---|---|
| `ship_to_address.full_name` | `order.shipping_address.first_name` + `order.shipping_address.last_name` |
| `ship_to_address.company` | `order.shipping_address.company` |
| `ship_to_address.address1` | `order.shipping_address.address1` |
| `ship_to_address.address2` | `order.shipping_address.address2` |
| `ship_to_address.city` | `order.shipping_address.city` |
| `ship_to_address.state` | `order.shipping_address.state` |
| `ship_to_address.postal_code` | `order.shipping_address.zip` |
| `ship_to_address.country` | `order.shipping_address.country` |
| `ship_to_address.phone_number` | `order.shipping_address.phone` |
| `ship_to_address.email_address` | `order.email` |

### Order Line Items

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `product_id` | `line_item.product.sku` | Formatted as `"{sku}_{account_id}"` |
| `sku` | `line_item.product.sku` | Falls back to `line_item.sku` |
| `quantity` | `line_item.quantity` | Deduplicated by SKU; kit component quantities subtracted |
| `unit_price` | `line_item.price` | |
| `is_picked` | Derived from `line_item.tote_picks` and `line_item.quantity_pending_fulfillment` | `true` if picked qty matches ordered qty or pending == 0 |
| `discount_amount` | `line_item.promotion_discount` | |

---

## Shipments

Shipments are nested within orders via `order.shipments`.

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `shipment_id` | `shipment.id` | GraphQL node ID |
| `warehouse_id` | `shipment.warehouse_id` | Falls back to line item `locked_to_warehouse_id` |
| `status` | Derived from `shipping_label.status` | `"cancelled"` if any label is `"void"`, else `"shipped"` |
| `raw_status` | `shipping_label.status` | From first label |
| `shipped_date` | `shipment.created_date` | Best approximation available |
| `shipping_method` | `order.shipping_lines.method` | Order-level value |
| `ship_from_address` | Warehouse address (looked up by `warehouse_id`) | |

### Shipment Ship-To Address

| Trackstar Field | ShipHero Field |
|---|---|
| `ship_to_address.full_name` | `shipment.address.name` |
| `ship_to_address.address1` | `shipment.address.address1` |
| `ship_to_address.address2` | `shipment.address.address2` |
| `ship_to_address.city` | `shipment.address.city` |
| `ship_to_address.state` | `shipment.address.state` |
| `ship_to_address.postal_code` | `shipment.address.zip` |
| `ship_to_address.country` | `shipment.address.country` |
| `ship_to_address.phone_number` | `shipment.address.phone` |

### Shipment Line Items

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `inventory_item_id` | `line_item.product.sku` | Formatted as `"{sku}_{account_id}"` |
| `sku` | `line_item.product.sku` | Kit components expanded into individual entries |
| `quantity` | `shipment_line_item.quantity` | Multiplied by kit component qty for kits |
| `parent_product_id` | `line_item.product.sku` (if kit) | `"{kit_sku}_{account_id}"`, null if not a kit |

---

## Packages

Packages are nested within shipments. Each `shipping_label` on a shipment becomes one package.

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `package_id` | `shipping_label.id` | Falls back to `tracking_number` |
| `package_name` | `shipping_label.box_name` | |
| `tracking_number` | `shipping_label.tracking_number` | |
| `tracking_url` | `shipping_label.tracking_url` | |
| `shipping_method` | `shipping_label.shipping_method` | Falls back to order-level `shipping_lines.method` |
| `shipping_method_id` | `shipping_label.shipping_method` | Falls back to order-level |
| `shipping_method_name` | `shipping_label.shipping_name` | Falls back to order-level `shipping_lines.title` |
| `carrier` | `shipping_label.carrier` | |
| `carrier_id` | `shipping_label.carrier` | |
| `carrier_name` | `shipping_label.carrier` | |
| `shipping_cost` | `shipping_label.cost` | |
| `measurements.weight` | `shipping_label.dimensions.weight` | Parsed from string (e.g. "1.5 kg"); grams converted to kg |
| `measurements.height` | `shipping_label.dimensions.height` | Parsed from string (e.g. "6 inch") |
| `measurements.width` | `shipping_label.dimensions.width` | Parsed from string |
| `measurements.length` | `shipping_label.dimensions.length` | Parsed from string |
| `measurements.unit` | Parsed from dimension strings | "inch" normalized to "in" |
| `scac` | — | Not available |

### Package Line Items

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `inventory_item_id` | `line_item.product.sku` | Formatted as `"{sku}_{account_id}"` |
| `sku` | `line_item.product.sku` | Kit components expanded |
| `quantity` | `shipment_line_item.quantity` | Multiplied by kit component qty for kits |
| `lot_id` | `line_item.shipped_line_item_lots[0].lot_id` | First lot only |
| `expiration_date` | `line_item.shipped_line_item_lots[0].lot_expiration_date` | ISO 8601 |
| `parent_product_id` | `line_item.product.sku` (if kit) | `"{kit_sku}_{account_id}"`, null if not a kit |

---

## Inventory

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `id` | `product.sku` + `product.account_id` | Formatted as `"{sku}_{account_id}"` |
| `name` | `product.name` | Falls back to `id` |
| `sku` | `product.sku` | |
| `warehouse_customer_id` | `product.account_id` | |
| `created_date` | `product.created_at` | ISO 8601 |
| `updated_date` | Latest `warehouse_product.updated_at` | ISO 8601; across all warehouse products |
| `active` | `warehouse_product.active` | `true` if active in any warehouse |
| `unit_cost` | `warehouse_product.value` | First non-zero value found |
| `onhand` | `warehouse_product.on_hand` + `warehouse_product.non_sellable_quantity` | Summed across all warehouses; non-sellable included in onhand |
| `committed` | `warehouse_product.allocated` | Summed across all warehouses |
| `fulfillable` | `warehouse_product.available` | Summed across all warehouses |
| `unfulfillable` | `warehouse_product.non_sellable_quantity` | Summed across all warehouses |
| `unsellable` | — | Always `0` (ShipHero doesn't distinguish from unfulfillable) |
| `sellable` | `warehouse_product.available` + `sell_ahead_quantity` | sell_ahead from pending inbounds |
| `awaiting` | Pending inbound `quantity - quantity_received - quantity_rejected` | Only inbounds with `status == "pending"` |
| `external_system_url` | `product.id` | `https://app.shiphero.com/dashboard/inventory/{id}` |

### Inventory by Warehouse

Each `warehouse_product` produces a per-warehouse breakdown under `inventory_by_warehouse_id[warehouse_id]`:

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `onhand` | `warehouse_product.on_hand` + `warehouse_product.non_sellable_quantity` | |
| `committed` | `warehouse_product.allocated` | |
| `fulfillable` | `warehouse_product.available` | |
| `unfulfillable` | `warehouse_product.non_sellable_quantity` | |
| `unsellable` | — | Always `0` |
| `sellable` | `warehouse_product.available` + `sell_ahead` | |
| `awaiting` | Pending inbound delta | |

### Measurements

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `measurements.weight` | `product.dimensions.weight` | Parsed from string; grams converted to kg |
| `measurements.weight_unit` | Parsed from `dimensions.weight` | "g" normalized to "kg" |
| `measurements.length` | `product.dimensions.length` | Parsed from string |
| `measurements.width` | `product.dimensions.width` | Parsed from string |
| `measurements.height` | `product.dimensions.height` | Parsed from string |
| `measurements.unit` | Parsed from dimension strings | "inch" normalized to "in" |

### Lots

Built from warehouse product location data where `expiration_lot` is present:

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `lot_id` | `location.expiration_lot.id` | |
| `expiration_date` | `location.expiration_lot.expires_at` | ISO 8601 |
| `onhand` | `location.quantity` | Summed across locations sharing the same lot + warehouse |
| `warehouse_id` | `warehouse_product.warehouse_id` | |

### Locations

| Trackstar Field | ShipHero Field | Notes |
|---|---|---|
| `location_id` | `location.location_id` | |
| `quantity` | `location.quantity` | Summed across entries with same location + warehouse |
| `warehouse_id` | `warehouse_product.warehouse_id` | |
