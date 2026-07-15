# iPoint Complete App Flow and Screen Flow V1.0

## 1. Purpose

This document is the machine-readable companion to the visual App Flow. It defines major flows and ownership boundaries. Detailed page behavior remains governed by the relevant PRD and Product Design System.

## 2. Shared entry flow

1. Launch application
2. Load supported language and market configuration
3. Display legal/consent requirement
4. Register, log in, or reset password
5. Verify email OTP where required
6. Resolve account role and status
7. Resolve Account Country and Current Market
8. Route to Member, Merchant, or Admin surface

No guest account is supported for protected application features.

## 3. Member onboarding

1. Accept terms and disclaimer
2. Enter email and verification code
3. Create credentials
4. Capture minimum registration fields
5. Assign unique Member ID and referral code
6. Resolve referrer if supplied
7. Create account-level profile
8. Create or lazily initialize market wallet views
9. Enter Member home
10. Require Level 2 KYC before redemption or agent upgrade

## 4. Member core navigation

- Home: banners, Current Market, wallet summary, key actions
- Merchant discovery: list, categories, online/offline, package visibility
- Merchant detail: profile, hours, contact, location, navigation link
- Show My QR: universal member QR for transaction and referral use cases
- Wallet: market-specific iPoint balance, pending reward, ledger/history
- Redemption Center: market catalog, rate, eligibility, order status
- Team: referral tree and agent-related views
- Agent: activation status, course/payment/KYC progress, commission summaries
- Settings: profile, Account Country request, Current Market, language, KYC, security

## 5. Current Market switch

1. Member opens market selector
2. System lists enabled markets
3. Member selects market
4. System updates Current Market context
5. Merchant, banners, wallet view, redemption, and future market content refresh
6. Account Country and account identity remain unchanged

## 6. Merchant onboarding

1. Accept terms and disclaimer
2. Register/login and verify immutable merchant email
3. Record recommending agent/referrer where applicable
4. Submit business profile, address, contacts, hours, logo/banner/gallery
5. Upload registration documents and responsible-person identity documents
6. Admin reviews KYC
7. Merchant selects or receives approved service-fee package(s)
8. Merchant tops up MCP
9. Merchant becomes active only after required approvals and minimum MCP condition
10. Merchant enters dashboard

## 7. Merchant transaction flow

1. Merchant starts new transaction
2. Enter sale amount
3. Select package when merchant owns two or more active packages
4. Scan member universal QR
5. Validate merchant status, member status, market, amount, package, MCP sufficiency, duplicate receipt, and receipt expiry
6. Show confirmation summary including service fee and MCP deduction
7. Merchant confirms; confirmation is final for the normal user flow
8. System creates Transaction ID and Receipt ID
9. System records package/rule snapshot
10. System debits MCP through ledger
11. System creates member reward entitlement under the consumption market
12. System creates commission entitlement sources where applicable
13. Show success receipt
14. Make transaction searchable by Transaction ID, Receipt ID, and Member ID

A pending receipt is valid for 60 minutes. Duplicate confirmation must be prevented.

## 8. MCP flow

- View current MCP balance and ledger
- Open calculator to estimate supported sales by package percentage
- Top up through payment gateway or manual proof submission
- Admin reviews manual top-up
- Approved top-up creates MCP credit ledger
- Advertisement approval may create MCP debit
- Refund requests are reviewed by Admin
- Suspension preserves MCP; restoration makes it available again

## 9. Daily iPoint reward flow

1. Confirmed transaction creates a reward entitlement source
2. Entitlement stores market, qualifying amount, reward-rule version, start date, cap/target, and status
3. At market-local 00:00, settlement job selects eligible entitlements
4. Job calculates that day's reward using the version locked to the entitlement
5. Job writes an immutable iPoint ledger credit
6. Wallet snapshot updates transactionally
7. Job records idempotency and settlement batch
8. Entitlement stops when cap, cancellation, expiry, or administrative rule condition is reached

## 10. Agent activation and commission flow

1. Member requests agent upgrade
2. Complete Level 2 KYC
3. Pay market-configured agent fee; RM388 is the current Malaysia baseline
4. Complete required company course
5. Admin/system validates conditions
6. Activate official agent status
7. Generate agent-fee commission entitlements for eligible first and second generation uplines
8. Future qualifying member transactions generate consumption commission entitlements
9. Recommended merchants generate one-generation merchant commission entitlement
10. Commission moves through Pending, Qualified, Paid, Cancelled, or Frozen

Five-level team performance rewards remain deferred until final approval.

## 11. Redemption flow

1. Member selects Current Market wallet
2. Browse active market redemption items
3. View required iPoint amount and current market redemption rate
4. System checks KYC, wallet, item stock, eligibility, and limits
5. Member confirms
6. System creates redemption order and iPoint debit/hold ledger
7. Admin or fulfillment process handles order
8. Order status becomes processing, fulfilled, rejected, cancelled, or refunded
9. Rejection/refund uses compensating ledger entries

## 12. Admin major flows

- Dashboard and market filtering
- Member search, status, KYC, Account Country change review
- Merchant review, package assignment, activation, suspension, branch management
- MCP top-up/refund/manual adjustment with Maker/Checker where required
- Transaction search, risk review, dispute handling, audit
- Reward rule and redemption rate version management
- Daily settlement monitoring and rerun controls
- Agent activation, course/payment verification, commission review
- Advertisement submission review, scheduling, and MCP charging
- Role, market access, and action permission management
- Reports, reconciliation, audit logs, and system configuration

## 13. Required state coverage

Every applicable screen must define loading, empty, error, success, disabled, expired, suspended, permission-denied, offline, and retry states.
