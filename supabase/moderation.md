# KOESELL moderation runbook (v0.4)

Status: manual review only. **No automated fraud/voice-cloning detection, no identity verification, no public launch authorization.**
The related SQL migration has already been applied in the dedicated Supabase project.

Project dashboard: https://supabase.com/dashboard/project/tiyyxtbmaxtdsmmrdsjd
SQL editor: https://supabase.com/dashboard/project/tiyyxtbmaxtdsmmrdsjd/sql/new
Storage bucket: `koeni-previews` (PRIVATE).

## Listing review queue

Run in the Supabase project SQL editor (dashboard admin context):

```sql
select id, created_at, seller_name, title, category, voice_tag,
       review_status, is_published, preview_path
from public.voice_listings
where review_status='pending'
order by created_at asc;
```

Check the submitted audio sample in the private Storage bucket and the listing details. Ask for additional verification rather than approving a questionable impersonation, synthetic imitation, third-party recording, celebrity/character imitation or deceptive scripted message.

Approval (replace the UUID after verifying the correct submission):

```sql
update public.voice_listings
set review_status='approved', is_published=true, reviewed_at=now()
where id='REPLACE_WITH_LISTING_UUID'::uuid and review_status='pending'
returning id, title, review_status, is_published;
```

Rejection:

```sql
update public.voice_listings
set review_status='rejected', is_published=false, reviewed_at=now()
where id='REPLACE_WITH_LISTING_UUID'::uuid and review_status='pending'
returning id, title, review_status, is_published;
```

## Abuse reports

```sql
select r.id, r.created_at, r.reason, r.details,
       r.listing_id, l.title, l.review_status, l.is_published
from public.voice_reports r
join public.voice_listings l on l.id=r.listing_id
order by r.created_at desc;
```

Reports do NOT automatically suspend a listing. Review them as soon as possible. In urgent cases, hide the listing:

```sql
update public.voice_listings
set review_status='rejected', is_published=false, reviewed_at=now()
where id='REPLACE_WITH_LISTING_UUID'::uuid
returning id, title, review_status, is_published;
```

Private Storage prevents new unauthorised requests after suspension. Previously issued signed preview URLs can remain valid for up to 180 seconds; a previously obtained copy cannot be recalled.

## Guardrails

- The public/anonymous frontend must never hold a `service_role` or other secret key.
- Client INSERT is permitted only as pending/non-public; authenticated users cannot UPDATE listings.
- The `voice_reports` table is insert-only for signed-in users; other users cannot read reports.
- Do not switch `koeni-previews` bucket back to public. Approved audio is accessed through short-lived signed URLs controlled by Storage policies.
- Do not upload paid full-length recordings, ID documents or sensitive user information to this preview bucket.
- A human approval label is **not** proof of identity or legal rights. Additional review, rights handling, privacy terms, and seller identity checks remain outstanding.
- The live marketplace must not be promoted to public user submissions until an actual review and report-response process is staffed.

## Prelaunch items

Seller identity/rights verification, visible terms and privacy policy, takedown contact,
report notification or dashboard, appeal procedure, abuse-rate limits, audio format inspection,
and paid delivery in a separate private bucket.
