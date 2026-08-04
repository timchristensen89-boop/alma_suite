# Creditor claims (creditor_claims)

Proofs of debt. Only external claims participate unless switched on.

Target: fc_creditor_claims
Duplicate detection key: company_code + creditor_name

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `creditor_name` | string | yes | NA | Creditor name. |
| `creditor_class` | enum | yes | NA | Claim class. Drives participation. |
| `related_party` | boolean | no | NA | Whether the creditor is a related party. |
| `secured` | boolean | no | NA | Whether the claim is secured. |
| `priority` | boolean | no | NA | Whether the claim is a priority claim. |
| `claimed_amount` | money | yes | INCLUSIVE | Amount claimed. |
| `admitted_amount` | money | no | INCLUSIVE | Amount admitted by the administrator. Blank until adjudicated. |
| `excluded_from_distribution` | boolean | no | NA | Explicit exclusion on top of the class default. |
| `notes` | string | no | NA | Free text. |

Money columns are entered in DOLLARS and stored as integer cents.
