-- ==========================================================
-- Seed data: Virtual Gifts Catalog & Coin Packages
-- ==========================================================

INSERT INTO gifts (name, emoji, price_coins, category, sort_order) VALUES
('Rose',           '🌹', 5,    'standard', 1),
('Heart',          '❤️', 10,   'standard', 2),
('Golden Love',    '💛', 25,   'standard', 3),
('Clap',           '👏', 15,   'standard', 4),
('Kiss',           '💋', 20,   'standard', 5),
('Teddy Bear',     '🧸', 50,   'premium',  6),
('Bouquet',        '💐', 75,   'premium',  7),
('Ring',           '💍', 150,  'premium',  8),
('Diamond',        '💎', 200,  'premium',  9),
('Crown',          '👑', 500,  'luxury',   10),
('Sports Car',     '🏎️', 1000, 'luxury',   11),
('Yacht',          '🛥️', 2500, 'luxury',   12),
('Private Jet',    '✈️', 5000, 'luxury',   13),
('Castle',         '🏰', 10000,'luxury',   14),
('Fireworks',      '🎆', 300,  'event',    15),
('Birthday Cake',  '🎂', 80,   'event',    16);

INSERT INTO coin_packages (name, coins, bonus_coins, price_amount, currency, sort_order) VALUES
('Starter Pack',   100,   0,   500.00,   'NGN', 1),
('Popular Pack',   550,   50,  2500.00,  'NGN', 2),
('Value Pack',     1200,  150, 5000.00,  'NGN', 3),
('Pro Pack',       2600,  400, 10000.00, 'NGN', 4),
('VIP Pack',       7000,  1500,25000.00, 'NGN', 5),
('Elite Pack',     15000, 4000,50000.00, 'NGN', 6);