# LearnLanka — Requirements Document

## 1. Problem Statement

O/L and A/L students in Sri Lanka currently find tutors through word of mouth, informal WhatsApp/Facebook groups, or physical tuition classes. There is no trusted, searchable marketplace that lets a student filter by subject, grade, language, and price, book a specific 1 hour slot, and pay safely online. This creates friction on both sides. Students can't easily verify a tutor's quality or availability before committing money, and tutors have no reliable way to fill idle hours, get paid on time, or build a reputation. LearnLanka aims to fix this by giving students a fast way to find and book vetted tutors, and giving tutors a predictable, low-admin way to publish availability and get paid weekly with the platform taking a 15% commission for making the match happen.

## 2. Personas

### Persona 1: The Student 

- **Goals:** 

Find an affordable and same language tutor for a specific subject before an upcoming exam.
Book a session that fits around school and other tuition.
Trust that the tutor is legitimate before paying.

- **Frustrations:** 

Limited mobile data, so a slow or heavy app is a dealbreaker.
Anxious about paying a stranger online without knowing if the session will actually happen. Doesn't want to browse dozens of irrelevant tutors to find one in the right language and price range.


### Persona 2: The Tutor 

- **Goals:** 

Fill idle hours with paying students without manually coordinating over WhatsApp. 
Paid reliably every week without chasing anyone.
Build a visible rating that brings in more bookings over time.

- **Frustrations:** 

No-shows and last-minute cancellations that cost him a slot he could've filled.
Commission eating into an already thin hourly rate.
Having to update his availability across multiple channels.

### Persona 3: The Ops Admin 

- **Goals:**

Resolve disputes (no-shows, bad ratings, payment issues) quickly and fairly.
Keep the weekly payout process error-free.
Make sure the platform stays compliant with Sri Lanka's PDPA 2022.

- **Frustrations:**

No first hand visibility into session quality because video is outsourced to a third party. Manual reconciliation before every payout run.
Handling complaints in Sinhala/Tamil when support tooling may default to English.

## 3. Functional Requirements

### Student

1. **FR-S1:** 
A Student can search for tutors, filtering results by subject, grade, language (Sinhala, Tamil, or English), and price band.
2. **FR-S2:** 
A Student can view a tutor's profile — rating, price, subjects taught, and open slots — before booking.
3. **FR-S3:** 
A Student can book a single available 1 hour slot with a specific tutor.
4. **FR-S4:** 
A Student can pay for a booking at the time of booking, using either a card or eZ Cash.
5. **FR-S5:** 
A Student can rate the tutor (1–5 stars) and leave a one-line comment after a session is marked complete.
6. **FR-S6:** 
A Student can submit a request to delete their personal data, in line with PDPA 2022.

### Tutor

7. **FR-T1:** 
A Tutor can publish and edit their own available time slots.
8. **FR-T2:** 
A Tutor can accept or decline an incoming booking request.
9. **FR-T3:** 
A Tutor can cancel a confirmed booking, provided it is at least 12 hours before the session start time.
10. **FR-T4:** 
A Tutor can rate the Student (1–5 stars) and leave a one-line comment after a session is marked complete.
11. **FR-T5:** 
A Tutor receives a payout of their net earnings (gross session fees minus 15% commission) via bank transfer on a weekly cycle.

### Ops Admin

12. **FR-A1:** 
An Ops Admin can view all completed, cancelled, and disputed sessions across the platform.
13. **FR-A2:** 
An Ops Admin can review and export the weekly payout batch before it is sent to the bank.
14. **FR-A3:** 
An Ops Admin can action a data-deletion request submitted by a Student or Tutor.
15. **FR-A4:** 
An Ops Admin can suspend a Student or Tutor account for a policy violation (e.g., repeated late cancellations).

## 4. Non-Functional Requirements

| Category | Metric | Target | How we'll measure it |
|---|---|---|---|
| Latency | Tutor search API response time (p95) | < 800 ms, measured from a Sri Lankan ISP | Azure Application Insights |
| Availability | Booking endpoint successful-response rate | 99.5% uptime per calendar month | Azure Monitor + external synthetic checks |
| Concurrency | Active simultaneous video sessions | ≥ 200 supported within the first 6 months | Load testing against Daily.co/100ms + vendor dashboard |
| Privacy | PDPA 2022 consent capture & deletion flow | 100% of new accounts show a recorded consent event,deletion requests fulfilled within an agreed SLA (assumed 30 days — see Assumptions) | Compliance audit of consent logs + deletion request tracker |
| Payment security | Cardholder/eZ Cash data stored on LearnLanka infrastructure | Zero — all payment data handled by PayHere (PCI-DSS compliant gateway) | Architecture review |
| Localization | UI string coverage | 100% of system UI strings available in Sinhala, Tamil, and English at launch | i18n coverage report generated at build time |

## 4a. Constraints (fixed, non-negotiable — distinct from NFRs)


| Constraint | Why it's a constraint, not an NFR |
|---|---|
| Must run on Azure (App Service, Azure SQL, Blob Storage) | Company already holds Azure credits — this isn't a "how well" question, it's a fixed platform decision |
| Video calling must be outsourced to Daily.co or 100ms, not built in-house | A build-vs-buy decision made before this document existed |
| Payment gateway must be PayHere; payouts must run through Sampath Vishwa | Vendor relationships already in place, not something engineering can trade off |
| Product must be mobile-first, assuming ≥80% Android usage | A market-fact input to design decisions, not a quality target we can dial up or down |
| UI must support Sinhala, Tamil, and English from launch | A go-to-market requirement, not a measurable "how fast/how available" attribute |

## 5. Assumptions

1. A "1-hour session" is exactly 60 minutes; there is no support for 30-minute or 90-minute sessions in this version.
2. "Vetted tutors" implies some onboarding/verification step exists before a tutor can list publicly — assumed to be a manual admin review (not an automated check) until confirmed otherwise.
3. The brief doesn't say who adjudicates a dispute or issues a refund — assumed the Ops Admin manually reviews disputes and triggers refunds through PayHere's refund API.
4. eZ Cash payments are assumed to be routed through PayHere's existing integration rather than a separate mobile-wallet integration.
5. If a Tutor cancels within the 12-hour window, it's assumed the Student is still fully refunded and the late cancellation is logged against the Tutor's record for Ops review — the brief doesn't state a formal penalty.
6. Video sessions are assumed **not** to be recorded in this version, to avoid additional PDPA and storage complexity.
7. The PDPA "deletion request" fulfillment window is assumed to be 30 days, in line with common data-protection practice, pending confirmation with LearnLanka's legal/compliance advisor.
8. Only LKR (Sri Lankan Rupee) is assumed as the transaction currency — no multi-currency support is needed.

## 6. Out of Scope

1. Group tutoring or one-to-many session formats — this version only supports 1-to-1 sessions.
2. A native iOS app — given the 80% Android usage assumption, iOS support is deferred to a mobile-responsive web experience only for this version.
3. In-app chat/messaging between Student and Tutor outside of the booking and session flow.
4. Homework or assignment submission, grading, or file-sharing features.
5. An in-house video calling engine — video is explicitly outsourced to Daily.co or 100ms, so no video infrastructure is being built by the LearnLanka team.
6. Automated (AI-based) tutor vetting, such as document verification or ID-matching — this version assumes manual admin review only.