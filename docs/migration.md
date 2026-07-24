# Data Migration

## Objective

Define how to incorporate data from the old system or existing spreadsheets into the new system.

## Expected Data from Old System

The old system could export:

- Collectors/sellers.
- Buyers.
- Numbers corresponding to each buyer.
- Buyer-collector relationship.
- Previous campaign.

## Strategy

Migration must go through staging before affecting definitive tables.

```txt
Export old system
↓
Normalize file
↓
Load to staging
↓
Validate data
↓
Resolve conflicts
↓
Confirm migration
↓
Generate historical data or reservations
```

## Minimum Staging Data

### Collectors

- Name.
- Phone.
- Email if available.
- External code if available.

### Buyers

- Name or business name.
- Phone.
- ID or CUIT if available.
- Address if available.
- External code if available.

### Number History

- Previous campaign.
- Usual number.
- Buyer.
- Collector.
- Bond type if available.

## Validations

- Duplicate buyers.
- Duplicate collectors.
- Repeated numbers in the same historical campaign.
- Buyer without collector.
- Collector not found.
- Invalid number format.
- Inconsistent phones or IDs.

## Migration Result

Migration can create:

- Collectors.
- Buyers.
- Number history.
- Usual buyer-collector relationship.
- Suggested reservations for new campaign.
- Renewal conflicts.

## Historical Reservations

Migration must not automatically sell new bonds.

It should generate suggestions or reservations:

```txt
Historical buyer
↓
Usual number
↓
Usual collector
↓
System checks availability in new campaign
↓
Reservation or conflict
```

## Conflicts

Examples:

- Historical number does not exist in new campaign.
- Historical number belongs to a pata.
- Historical number was already assigned to another buyer.
- Duplicate buyer.
- Non-existent collector.

Each conflict must be resolvable manually.

## Security Rules

- Do not write definitive data without preview.
- Do not overwrite existing buyers without confirmation.
- Do not delete migrated data without audited voiding.
- Save source file or reference to the import when possible.
