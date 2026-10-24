-- Testimonial ratings can be half stars (4.5). They were whole numbers 1 to 5; existing ratings keep
-- their value. Allowed: 0.5 to 5 in steps of 0.5.
alter table public.testimonials drop constraint if exists testimonials_rating_check;
alter table public.testimonials alter column rating type numeric(2, 1) using rating::numeric;
alter table public.testimonials add constraint testimonials_rating_check
  check (rating is null or (rating between 0.5 and 5 and rating * 2 = round(rating * 2)));

notify pgrst, 'reload schema';
