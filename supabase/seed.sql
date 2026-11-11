-- Starting catalogue and editorial content. Safe to run more than once.

insert into public.categories (id, name, code, unit, sort) values
  ('sling', 'Sling Bags', 'SL', 'Sling Bag', 0),
  ('mens', 'Men’s Sling Bags', 'MS', 'Men’s Sling Bag', 1),
  ('laptop', 'Laptop Bags', 'LP', 'Laptop Bag', 2)
on conflict (id) do nothing;

insert into public.products (id, category, colour, hex, price, stock, status, image, description, sort) values
  ('VRT-SL-CRI', 'sling', 'Crimson', '#a82a2e', 1799, 14, 'active', 'asset:sling', 'Compact and organised, with a detachable strap so it carries by hand or across the body.', 0),
  ('VRT-SL-COB', 'sling', 'Cobalt', '#1f3fb0', 1799, 3, 'active', 'asset:sling', 'Compact and organised, with a detachable strap so it carries by hand or across the body.', 1),
  ('VRT-SL-BLA', 'sling', 'Black', '#1c1b1a', 1799, 22, 'active', 'asset:sling', 'Compact and organised, with a detachable strap so it carries by hand or across the body.', 2),
  ('VRT-SL-MUS', 'sling', 'Mustard', '#e0b00f', 1799, 0, 'active', 'asset:sling', 'Compact and organised, with a detachable strap so it carries by hand or across the body.', 3),
  ('VRT-SL-FOR', 'sling', 'Forest', '#1f7a55', 1799, 9, 'active', 'asset:sling', 'Compact and organised, with a detachable strap so it carries by hand or across the body.', 4),
  ('VRT-MS-NAV', 'mens', 'Navy', '#1e2f73', 1999, 11, 'active', 'asset:mens', 'A slim crossbody with a wide webbing strap, metal hardware and a zip pocket on the front.', 5),
  ('VRT-MS-MUS', 'mens', 'Mustard', '#e0b00f', 1999, 6, 'active', 'asset:mens', 'A slim crossbody with a wide webbing strap, metal hardware and a zip pocket on the front.', 6),
  ('VRT-MS-TEA', 'mens', 'Teal', '#1f8a78', 1999, 1, 'active', 'asset:mens', 'A slim crossbody with a wide webbing strap, metal hardware and a zip pocket on the front.', 7),
  ('VRT-MS-MAR', 'mens', 'Maroon', '#8a1f2a', 1999, 19, 'active', 'asset:mens', 'A slim crossbody with a wide webbing strap, metal hardware and a zip pocket on the front.', 8),
  ('VRT-MS-BLA', 'mens', 'Black', '#1c1b1a', 1999, 25, 'active', 'asset:mens', 'A slim crossbody with a wide webbing strap, metal hardware and a zip pocket on the front.', 9),
  ('VRT-LP-CRI', 'laptop', 'Crimson', '#a82a2e', 2499, 8, 'active', 'asset:laptop', 'Room for a laptop and the day that goes with it, with twin handles and a front pocket.', 10),
  ('VRT-LP-COB', 'laptop', 'Cobalt', '#1f3fb0', 2499, 12, 'active', 'asset:laptop', 'Room for a laptop and the day that goes with it, with twin handles and a front pocket.', 11),
  ('VRT-LP-BLA', 'laptop', 'Black', '#1c1b1a', 2499, 4, 'active', 'asset:laptop', 'Room for a laptop and the day that goes with it, with twin handles and a front pocket.', 12),
  ('VRT-LP-MUS', 'laptop', 'Mustard', '#e0b00f', 2499, 17, 'active', 'asset:laptop', 'Room for a laptop and the day that goes with it, with twin handles and a front pocket.', 13),
  ('VRT-LP-FOR', 'laptop', 'Forest', '#1f7a55', 2499, 2, 'active', 'asset:laptop', 'Room for a laptop and the day that goes with it, with twin handles and a front pocket.', 14)
on conflict (id) do nothing;

insert into public.site_content (id, published) values (1, '{"announcement":{"enabled":true,"text":"Sling bags, men’s slings and laptop bags, each in five colours.","linkLabel":"Shop now","linkHref":"#shop"},"hero":{"headline":"The art of utility.","sub":"Bags built around how you actually move through the day.","cta":"Shop the collection","slides":[{"image":"asset:hero1","caption":"Laptop bags in five colours"},{"image":"asset:hero2","caption":"Slings and laptop bags, together"},{"image":"asset:hero3","caption":"Men’s sling bags in five colours"}]},"collections":[{"id":"sling","visible":true,"title":"Sling Bags","image":"asset:sling","description":"Small enough for the day, organised enough for everything in it. Carry it by the handles or across the body."},{"id":"mens","visible":true,"title":"Men’s Sling Bags","image":"asset:mens","description":"A slim crossbody with a wide webbing strap and a zip pocket on the front, for the things you reach for most."},{"id":"laptop","visible":true,"title":"Laptop Bags","image":"asset:laptop","description":"A structured carry-all with room for a laptop and everything that travels with it, kept apart and easy to find."}]}'::jsonb)
on conflict (id) do nothing;

insert into public.settings (id, low_stock) values (1, 5)
on conflict (id) do nothing;
