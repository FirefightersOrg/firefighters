# Data Migration

## Objective

Define how to incorporate data from the old system or existing spreadsheets into the new system.

## Expected Data from the Old System

The old system could export:

- Collectors/sellers.
- Buyers.
- Numbers corresponding to each buyer.
- Buyer-collector relationship.
- Previous campaign.

## Strategy

The migration must go through staging before affecting final tables.

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
- Email if it exists.
- External code if it exists.

### Buyers

- Name or business name.
- Phone.
- Document or CUIT if it exists.
- Address if it exists.
- External code if it exists.

### Historical Number Records

- Previous campaign.
- Usual number.
- Buyer.
- Collector.
- Bond type if it exists.

## Validations

- Duplicate buyers.
- Duplicate collectors.
- Repeated numbers in the same historical campaign.
- Buyer without collector.
- Collector not found.
- Invalid number format.
- Inconsistent phones or documents.

## Migration Result

The migration can create:

- Collectors.
- Buyers.
- Number history.
- Usual buyer-collector relationship.
- Suggested reservations for the new campaign.
- Renewal conflicts.

## Historical Reservations

The migration must not automatically sell new bonds.

It must generate suggestions or reservations:

```txt
Historical buyer
↓
Usual number
↓
Usual collector
↓
System verifies availability in new campaign
↓
Reservation or conflict
```

## Conflicts

Examples:

- Historical number does not exist in the new campaign.
- Historical number belongs to a pata (multi-number bond/package).
- Historical number was already assigned to another buyer.
- Duplicate buyer.
- Nonexistent collector.

Each conflict must be manually resolvable.

## Security Rules

- Do not write final data without a preview.
- Do not overwrite existing buyers without confirmation.
- Do not delete migrated data without audited voiding.
- Save the source file or a reference to the import whenever possible.
