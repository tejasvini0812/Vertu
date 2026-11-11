-- OPTIONAL sample orders for a staging project. Do not run on production.
-- Invented customers (example.com addresses). Delete with: delete from public.orders where customer_email like '%@example.com';

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10428', now() - interval '1828 minutes', 'Processing', 'Arjun Bose', 'arjun.bose@example.com', '+91 98••• ••180', '60, Rose Lane', 'Kolkata', 'West Bengal', '700019')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10428', 'VRT-SL-FOR', 'sling', 'Forest', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10427', now() - interval '2076 minutes', 'Pending', 'Dev Malhotra', 'dev.malhotra@example.com', '+91 98••• ••579', '7, Rose Lane', 'Chandigarh', 'Chandigarh', '160017')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10427', 'VRT-LP-MUS', 'laptop', 'Mustard', 2499, 2),
  ('VRT-10427', 'VRT-SL-CRI', 'sling', 'Crimson', 1799, 1),
  ('VRT-10427', 'VRT-MS-MAR', 'mens', 'Maroon', 1999, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10426', now() - interval '3170 minutes', 'Shipped', 'Riya Desai', 'riya.desai@example.com', '+91 98••• ••185', '18, Rose Lane', 'Surat', 'Gujarat', '395007')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10426', 'VRT-LP-FOR', 'laptop', 'Forest', 2499, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10425', now() - interval '3459 minutes', 'Shipped', 'Naina Joshi', 'naina.joshi@example.com', '+91 98••• ••907', '37, Lake Street', 'Jaipur', 'Rajasthan', '302001')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10425', 'VRT-LP-MUS', 'laptop', 'Mustard', 2499, 2);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10424', now() - interval '4383 minutes', 'Processing', 'Tara Nair', 'tara.nair@example.com', '+91 98••• ••396', '66, Rose Lane', 'Kochi', 'Kerala', '682016')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10424', 'VRT-MS-BLA', 'mens', 'Black', 1999, 1),
  ('VRT-10424', 'VRT-MS-NAV', 'mens', 'Navy', 1999, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10423', now() - interval '5602 minutes', 'Shipped', 'Aditya Menon', 'aditya.menon@example.com', '+91 98••• ••187', '82, Park Avenue', 'Chennai', 'Tamil Nadu', '600028')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10423', 'VRT-SL-COB', 'sling', 'Cobalt', 1799, 2),
  ('VRT-10423', 'VRT-LP-COB', 'laptop', 'Cobalt', 2499, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10422', now() - interval '9662 minutes', 'Delivered', 'Vihaan Shah', 'vihaan.shah@example.com', '+91 98••• ••439', '87, Station Road', 'Ahmedabad', 'Gujarat', '380015')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10422', 'VRT-SL-COB', 'sling', 'Cobalt', 1799, 1),
  ('VRT-10422', 'VRT-MS-BLA', 'mens', 'Black', 1999, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10421', now() - interval '10200 minutes', 'Shipped', 'Zoya Khan', 'zoya.khan@example.com', '+91 98••• ••775', '3, Hill View Apartments', 'Lucknow', 'Uttar Pradesh', '226010')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10421', 'VRT-SL-BLA', 'sling', 'Black', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10420', now() - interval '12818 minutes', 'Delivered', 'Naina Joshi', 'naina.joshi@example.com', '+91 98••• ••665', '23, Lake Street', 'Jaipur', 'Rajasthan', '302001')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10420', 'VRT-SL-FOR', 'sling', 'Forest', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10419', now() - interval '12967 minutes', 'Delivered', 'Vihaan Shah', 'vihaan.shah@example.com', '+91 98••• ••993', '34, Park Avenue', 'Ahmedabad', 'Gujarat', '380015')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10419', 'VRT-LP-MUS', 'laptop', 'Mustard', 2499, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10418', now() - interval '14105 minutes', 'Shipped', 'Rohan Iyer', 'rohan.iyer@example.com', '+91 98••• ••965', '56, Park Avenue', 'Bengaluru', 'Karnataka', '560034')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10418', 'VRT-MS-TEA', 'mens', 'Teal', 1999, 1),
  ('VRT-10418', 'VRT-MS-MAR', 'mens', 'Maroon', 1999, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10417', now() - interval '15744 minutes', 'Delivered', 'Neel Agarwal', 'neel.agarwal@example.com', '+91 98••• ••760', '40, Lake Street', 'Indore', 'Madhya Pradesh', '452001')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10417', 'VRT-MS-MUS', 'mens', 'Mustard', 1999, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10416', now() - interval '16507 minutes', 'Shipped', 'Tara Nair', 'tara.nair@example.com', '+91 98••• ••367', '43, Garden Road', 'Kochi', 'Kerala', '682016')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10416', 'VRT-MS-NAV', 'mens', 'Navy', 1999, 2);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10415', now() - interval '17010 minutes', 'Delivered', 'Neel Agarwal', 'neel.agarwal@example.com', '+91 98••• ••268', '11, Rose Lane', 'Indore', 'Madhya Pradesh', '452001')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10415', 'VRT-MS-MUS', 'mens', 'Mustard', 1999, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10414', now() - interval '17346 minutes', 'Delivered', 'Tara Nair', 'tara.nair@example.com', '+91 98••• ••624', '14, Park Avenue', 'Kochi', 'Kerala', '682016')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10414', 'VRT-SL-BLA', 'sling', 'Black', 1799, 1),
  ('VRT-10414', 'VRT-SL-FOR', 'sling', 'Forest', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10413', now() - interval '18744 minutes', 'Delivered', 'Dev Malhotra', 'dev.malhotra@example.com', '+91 98••• ••577', '57, Hill View Apartments', 'Chandigarh', 'Chandigarh', '160017')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10413', 'VRT-LP-BLA', 'laptop', 'Black', 2499, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10412', now() - interval '20190 minutes', 'Delivered', 'Zoya Khan', 'zoya.khan@example.com', '+91 98••• ••118', '11, Lake Street', 'Lucknow', 'Uttar Pradesh', '226010')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10412', 'VRT-MS-TEA', 'mens', 'Teal', 1999, 1),
  ('VRT-10412', 'VRT-SL-COB', 'sling', 'Cobalt', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10411', now() - interval '21490 minutes', 'Delivered', 'Neel Agarwal', 'neel.agarwal@example.com', '+91 98••• ••733', '7, Lake Street', 'Indore', 'Madhya Pradesh', '452001')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10411', 'VRT-SL-MUS', 'sling', 'Mustard', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10410', now() - interval '21594 minutes', 'Delivered', 'Rohan Iyer', 'rohan.iyer@example.com', '+91 98••• ••974', '33, Station Road', 'Bengaluru', 'Karnataka', '560034')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10410', 'VRT-LP-FOR', 'laptop', 'Forest', 2499, 1),
  ('VRT-10410', 'VRT-SL-BLA', 'sling', 'Black', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10409', now() - interval '21745 minutes', 'Delivered', 'Aditya Menon', 'aditya.menon@example.com', '+91 98••• ••979', '29, Rose Lane', 'Chennai', 'Tamil Nadu', '600028')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10409', 'VRT-SL-FOR', 'sling', 'Forest', 1799, 1),
  ('VRT-10409', 'VRT-SL-MUS', 'sling', 'Mustard', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10408', now() - interval '24283 minutes', 'Delivered', 'Kiara Sethi', 'kiara.sethi@example.com', '+91 98••• ••107', '82, Garden Road', 'Panaji', 'Goa', '403001')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10408', 'VRT-MS-MUS', 'mens', 'Mustard', 1999, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10407', now() - interval '26905 minutes', 'Delivered', 'Zoya Khan', 'zoya.khan@example.com', '+91 98••• ••839', '15, Lake Street', 'Lucknow', 'Uttar Pradesh', '226010')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10407', 'VRT-SL-CRI', 'sling', 'Crimson', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10406', now() - interval '28742 minutes', 'Delivered', 'Riya Desai', 'riya.desai@example.com', '+91 98••• ••107', '53, Station Road', 'Surat', 'Gujarat', '395007')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10406', 'VRT-LP-COB', 'laptop', 'Cobalt', 2499, 1),
  ('VRT-10406', 'VRT-SL-MUS', 'sling', 'Mustard', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10405', now() - interval '29863 minutes', 'Delivered', 'Zoya Khan', 'zoya.khan@example.com', '+91 98••• ••838', '37, Rose Lane', 'Lucknow', 'Uttar Pradesh', '226010')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10405', 'VRT-LP-BLA', 'laptop', 'Black', 2499, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10404', now() - interval '35335 minutes', 'Delivered', 'Sahil Verma', 'sahil.verma@example.com', '+91 98••• ••246', '75, Rose Lane', 'Gurugram', 'Haryana', '122002')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10404', 'VRT-SL-CRI', 'sling', 'Crimson', 1799, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10403', now() - interval '36129 minutes', 'Delivered', 'Kiara Sethi', 'kiara.sethi@example.com', '+91 98••• ••984', '15, Station Road', 'Panaji', 'Goa', '403001')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10403', 'VRT-MS-TEA', 'mens', 'Teal', 1999, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10402', now() - interval '39880 minutes', 'Delivered', 'Dev Malhotra', 'dev.malhotra@example.com', '+91 98••• ••344', '8, Hill View Apartments', 'Chandigarh', 'Chandigarh', '160017')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10402', 'VRT-LP-FOR', 'laptop', 'Forest', 2499, 1);

insert into public.orders (id, created_at, status, customer_name, customer_email, customer_phone, ship_address, ship_city, ship_state, ship_pin)
values ('VRT-10401', now() - interval '40181 minutes', 'Delivered', 'Naina Joshi', 'naina.joshi@example.com', '+91 98••• ••649', '90, Park Avenue', 'Jaipur', 'Rajasthan', '302001')
on conflict (id) do nothing;
insert into public.order_items (order_id, sku, category, colour, price, qty) values
  ('VRT-10401', 'VRT-SL-FOR', 'sling', 'Forest', 1799, 1);

