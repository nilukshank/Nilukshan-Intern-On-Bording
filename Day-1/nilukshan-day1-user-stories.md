# LearnLanka — User Story Set

**Prepared by:** Nilukshan Krishnamenan


---

## Story 1: Tutor Search

**As a** student
**I want** to search for tutors by subject, grade, language, and price band
**So that** I can find a tutor who matches my specific learning needs and budget

### Acceptance Criteria

- **Given** I am logged in and on the search screen **when** I select subject "Combined Maths", grade "A/L", language "Sinhala", and price band "LKR 500–1000" and tap Search **then** a list of matching tutors is displayed within 800 ms

- **Given** search results are displayed **when** I view each tutor card **then** I can see the tutor's name, language of instruction, hourly rate, average star rating, and primary subject

- **Given** I apply filters that return no results **when** the search completes **then** I see a "No tutors found" message with a prompt to broaden my filters

- **Given** I am on a Sri Lankan 4G mobile connection **when** I perform any tutor search **then** 95% of responses complete in under 800 ms (p95 latency SLO)

### INVEST self-check

- [x] Independent — does not depend on any other story to function
- [x] Negotiable — the filter UI design is flexible only if the search behaviour is fixed
- [x] Valuable — the core discovery mechanic; without this students cannot find tutors
- [x] Estimable — clear enough for a developer to estimate (API + filter UI)
- [x] Small — fits within a 3–5 day sprint
- [x] Testable — acceptance criteria are observable and measurable

---

## Story 2: Session Booking

**As a** student
**I want** to book a 1-hour session from a tutor's available calendar slots
**So that** I can confirm a learning session at a time that fits my schedule

### Acceptance Criteria

- **Given** I am viewing a tutor's profile **when** I select an available time slot and tap "Book" **then** I am taken to a payment screen showing tutor name, session date/time, duration, and total cost

- **Given** I am on the payment screen **when** I complete payment successfully **then** my booking is confirmed and I receive a confirmation email and/or SMS within 60 seconds containing session details and a video join link

- **Given** a slot I selected becomes unavailable before I complete payment **when** I attempt to proceed **then** I see an error message and the calendar refreshes to show current availability

- **Given** my booking is confirmed **when** the tutor views their dashboard **then** the session appears in their upcoming sessions list and the slot is removed from available times

### INVEST self-check

- [x] Independent — relies on tutor having published slots 
- [x] Negotiable — calendar UI is flexible only ifthe booking confirmation flow is fixed
- [x] Valuable — core transaction,without booking there is no revenue
- [x] Estimable — well-scoped with clear payment integration point
- [x] Small — fits within a 4–5 day sprint
- [x] Testable — all criteria are observable and confirmable

---

## Story 3: Session Payment

**As a** student
**I want** to pay for my booked session via credit/debit card or eZ Cash
**So that** I can confirm my session without handling cash

### Acceptance Criteria

- **Given** I am on the payment screen **when** I select "Card" and enter valid card details via PayHere **then** the payment is processed, my booking is confirmed, and a receipt is emailed to me

- **Given** I select "eZ Cash" **when** I complete the eZ Cash authorisation flow via PayHere **then** my booking is confirmed and a receipt is sent to my mobile number

- **Given** my payment fails for any reason **when** the error is returned by PayHere **then** I see a specific error message (e.g., "Card declined — please check your details") and can retry without losing my selected slot for up to 5 minutes

- **Given** a payment is completed **when** LearnLanka processes the transaction **then** zero card or eZ Cash credentials are stored on LearnLanka servers

### INVEST self-check

- [x] Independent — payment flow is a distinct deliverable from booking UI
- [x] Negotiable — payment UI can vary as long as PayHere handles processing
- [x] Valuable — no payment = no business model
- [x] Estimable — PayHere integration is well-documented
- [x] Small — fits within 3–4 days with PayHere sandbox testing
- [x] Testable — all criteria are observable; PCI compliance is auditable

---

## Story 4: Tutor Availability Management

**As a** tutor
**I want** to publish my available time slots on a weekly calendar
**So that** students can book sessions at times that suit my schedule

### Acceptance Criteria

- **Given** I am logged in and on my availability calendar **when** I select a date and 1-hour time block and click "Add Slot" **then** the slot becomes visible on my public profile as bookable within 30 seconds

- **Given** a student books one of my published slots **when** the booking is confirmed **then** that slot is immediately removed from my public availability and marked as "booked" in my calendar

- **Given** I have an unpublished (no bookings) available slot **when** I click "Remove" **then** the slot is deleted from my calendar and no longer visible to students

- **Given** I try to add a slot that overlaps with an existing slot **when** I click "Add Slot" **then** I receive a conflict warning and the duplicate slot is not created

### INVEST self-check

- [x] Independent — tutor calendar is a standalone feature
- [x] Negotiable — calendar implementation (weekly/monthly view) is flexible
- [x] Valuable — without this, students have no sessions to book
- [x] Estimable — calendar + slot management is well-understood scope
- [x] Small — fits within a 3–4 day sprint
- [x] Testable — all slot states (available, booked, removed) are observable

---

## Story 5: Post-Session Rating

**As a** student
**I want** to rate my tutor and leave a short comment after a completed session
**So that** I can help other students make informed decisions when choosing a tutor

### Acceptance Criteria

- **Given** my session has been marked as completed **when** I log in within 48 hours **then** I see a rating prompt for that session on my dashboard

- **Given** I submit a rating between 1 and 5 stars with an optional comment of up to 200 characters **when** I click "Submit" **then** the rating is saved and the tutor's average star rating on their public profile updates within 60 seconds

- **Given** I have already submitted a rating for a session **when** I revisit that session **then** I see my submitted rating displayed and the rating form is no longer editable

- **Given** I do not rate within 48 hours of session completion **when** the window expires **then** the rating prompt is dismissed automatically and the session is marked as completed without a rating

### INVEST self-check

- [x] Independent — rating is a standalone post-session action
- [x] Negotiable — prompt timing (48 hours) and comment length are negotiable
- [x] Valuable — ratings build trust and drive tutor quality
- [x] Estimable — simple CRUD feature with a rating average calculation
- [x] Small — fits within 2–3 days
- [x] Testable — rating submission and profile update are observable

---

## Story 6: Weekly Tutor Payout

**As an** ops admin
**I want** to review and approve weekly tutor payouts through Sampath Vishwa
**So that** tutors receive their correct earnings on time every week

### Acceptance Criteria

- **Given** it is the weekly payout day (Friday) **when** I open the payout dashboard **then** I see all tutors with completed sessions listed, showing session count, gross amount, 15% commission deducted, and net payout amount

- **Given** I have reviewed the payout list and clicked "Approve All" **when** the payout is triggered **then** bank transfer instructions are sent to Sampath Vishwa via SFTP and each tutor receives an email notification with their individual payout breakdown within 30 minutes

- **Given** a tutor has an open dispute on a session **when** I view the payout list **then** that tutor's payout is flagged in orange and excluded from the current batch until the dispute is resolved

- **Given** the payout batch is sent **when** I view the admin log **then** a timestamped record of the batch including total disbursed and commission retained is saved and exportable as CSV

### INVEST self-check

- [x] Independent — payout flow is a standalone admin feature
- [x] Negotiable — dashboard layout is flexible; the SFTP output format to Sampath is fixed
- [x] Valuable — tutors will not stay on the platform without reliable payment
- [x] Estimable — SFTP integration with Sampath Vishwa is well-defined
- [ ] Small — **note: this story is medium-large (5–7 days) due to SFTP integration and dispute flag logic**
- [x] Testable — all payout states and outputs are observable

---

## Story 7: Session Search Latency (Non-Functional)

**As a** student on a mobile device connected to a Sri Lankan ISP
**I want** tutor search results to load within 800 ms
**So that** slow network conditions do not prevent me from finding and booking tutors

### Acceptance Criteria

- **Given** the system is under normal load (fewer than 200 concurrent users) **when** a tutor search request is made from a simulated Sri Lankan 4G connection **then** 95% of search API responses complete in under 800 ms as measured by Azure Application Insights

- **Given** the system is under peak load (200 concurrent users) **when** load testing is executed against the search endpoint **then** p95 latency remains under 800 ms with no increase in error rate

- **Given** search results are returned **when** the response is rendered on a mid-range Android device **then** the results list is visible and interactive within 3 seconds of the request being made

### INVEST self-check

- [x] Independent — can be tested as a standalone performance story
- [x] Negotiable — the implementation approach (caching, indexing) is flexible
- [x] Valuable — latency above 800 ms on mobile directly causes user abandonment
- [x] Estimable — load testing scope is clearly defined
- [x] Small — performance testing story fits in a 2–3 day sprint
- [x] Testable — Azure Application Insights provides measurable p95 data