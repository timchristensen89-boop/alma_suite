# Xero transactions (xero_transactions)

General transaction export from Xero.

Target: fc_xero_bank_transactions
Duplicate detection key: source_id

| Column | Type | Required | GST basis | Description |
| --- | --- | --- | --- | --- |
| `date` | date | yes | NA | Transaction date. |
| `company_code` | enum | yes | NA | Legal entity. TCC = Two Cooked Chooks (Avalon), AF = Alma Freshwater (St Alma). |
| `contact` | string | no | NA | Contact name. |
| `account_code` | string | no | NA | Xero account code. |
| `account_name` | string | no | NA | Xero account name. |
| `description` | string | no | NA | Line description. |
| `transaction_type` | string | no | NA | SPEND, RECEIVE, ACCPAY, ACCREC. |
| `invoice_number` | string | no | NA | Invoice number. |
| `invoice_date` | date | no | NA | Invoice date. |
| `due_date` | date | no | NA | Due date. |
| `gross_amount` | money | no | INCLUSIVE | Amount INCLUDING GST. |
| `net_amount` | money | no | EXCLUSIVE | Amount EXCLUDING GST. |
| `tax_amount` | money | no | NA | GST amount. |
| `tax_rate` | string | no | NA | Xero tax rate name. |
| `status` | string | no | NA | Status. |
| `bank_account` | string | no | NA | Bank account. |
| `tracking_category` | string | no | NA | Tracking category. |
| `source_id` | string | yes | NA | Xero record id — used for deduplication. |

Money columns are entered in DOLLARS and stored as integer cents.
