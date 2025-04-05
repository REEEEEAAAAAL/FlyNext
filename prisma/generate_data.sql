TRUNCATE TABLE "Airport", "City", "HotelReservation", "Hotel", "Itinerary", "Notification", "RoomAvailabilityRecord", "RoomType", "User", "FlightReservation" RESTART IDENTITY CASCADE;

-- ========================================
-- City
-- ========================================
INSERT INTO City (id, name, country) VALUES (1, 'Atlanta', 'United States');
INSERT INTO City (id, name, country) VALUES (2, 'Beijing', 'China');
INSERT INTO City (id, name, country) VALUES (3, 'Los Angeles', 'United States');
INSERT INTO City (id, name, country) VALUES (4, 'Dubai', 'United Arab Emirates');
INSERT INTO City (id, name, country) VALUES (5, 'Tokyo', 'Japan');
INSERT INTO City (id, name, country) VALUES (6, 'Chicago', 'United States');
INSERT INTO City (id, name, country) VALUES (7, 'London', 'United Kingdom');
INSERT INTO City (id, name, country) VALUES (8, 'Houston', 'United States');
INSERT INTO City (id, name, country) VALUES (9, 'Dallas', 'United States');
INSERT INTO City (id, name, country) VALUES (10, 'Guangzhou', 'China');
INSERT INTO City (id, name, country) VALUES (11, 'Amsterdam', 'Netherlands');
INSERT INTO City (id, name, country) VALUES (12, 'Frankfurt', 'Germany');
INSERT INTO City (id, name, country) VALUES (13, 'New York', 'United States');
INSERT INTO City (id, name, country) VALUES (14, 'Singapore', 'Singapore');
INSERT INTO City (id, name, country) VALUES (15, 'Toronto', 'Canada');
INSERT INTO City (id, name, country) VALUES (16, 'Madrid', 'Spain');
INSERT INTO City (id, name, country) VALUES (17, 'Seoul', 'South Korea');
INSERT INTO City (id, name, country) VALUES (18, 'Sydney', 'Australia');
INSERT INTO City (id, name, country) VALUES (19, 'Melbourne', 'Australia');
INSERT INTO City (id, name, country) VALUES (20, 'Bangkok', 'Thailand');
INSERT INTO City (id, name, country) VALUES (21, 'Brussels', 'Belgium');
INSERT INTO City (id, name, country) VALUES (22, 'Zurich', 'Switzerland');
INSERT INTO City (id, name, country) VALUES (23, 'Munich', 'Germany');
INSERT INTO City (id, name, country) VALUES (24, 'Vienna', 'Austria');
INSERT INTO City (id, name, country) VALUES (25, 'Istanbul', 'Turkey');
INSERT INTO City (id, name, country) VALUES (26, 'Barcelona', 'Spain');
INSERT INTO City (id, name, country) VALUES (27, 'Paris', 'France');
INSERT INTO City (id, name, country) VALUES (28, 'Rome', 'Italy');
INSERT INTO City (id, name, country) VALUES (29, 'Seattle', 'United States');
INSERT INTO City (id, name, country) VALUES (30, 'Miami', 'United States');
INSERT INTO City (id, name, country) VALUES (31, 'Boston', 'United States');
INSERT INTO City (id, name, country) VALUES (32, 'Vancouver', 'Canada');
INSERT INTO City (id, name, country) VALUES (33, 'Phoenix', 'United States');
INSERT INTO City (id, name, country) VALUES (34, 'São Paulo', 'Brazil');
INSERT INTO City (id, name, country) VALUES (35, 'Buenos Aires', 'Argentina');
INSERT INTO City (id, name, country) VALUES (36, 'Moscow', 'Russia');
INSERT INTO City (id, name, country) VALUES (37, 'New Delhi', 'India');
INSERT INTO City (id, name, country) VALUES (38, 'Jakarta', 'Indonesia');
INSERT INTO City (id, name, country) VALUES (39, 'Mexico City', 'Mexico');
INSERT INTO City (id, name, country) VALUES (40, 'Kuala Lumpur', 'Malaysia');
INSERT INTO City (id, name, country) VALUES (41, 'Manila', 'Philippines');
INSERT INTO City (id, name, country) VALUES (42, 'Mumbai', 'India');
INSERT INTO City (id, name, country) VALUES (43, 'Cape Town', 'South Africa');
INSERT INTO City (id, name, country) VALUES (44, 'Dublin', 'Ireland');
INSERT INTO City (id, name, country) VALUES (45, 'Helsinki', 'Finland');
INSERT INTO City (id, name, country) VALUES (46, 'Oslo', 'Norway');
INSERT INTO City (id, name, country) VALUES (47, 'Stockholm', 'Sweden');
INSERT INTO City (id, name, country) VALUES (48, 'Copenhagen', 'Denmark');
INSERT INTO City (id, name, country) VALUES (49, 'Lisbon', 'Portugal');
INSERT INTO City (id, name, country) VALUES (50, 'Prague', 'Czech Republic');

-- ========================================
-- User
-- ========================================
INSERT INTO "User" (id, email, password, firstName, lastName, profilePic, phone, "IsHotelOwner") VALUES 
(1, 'user1@example.com', 'password1', 'First1', 'Last1', NULL, NULL, false),
(2, 'user2@example.com', 'password2', 'First2', 'Last2', NULL, NULL, false),
(3, 'user3@example.com', 'password3', 'First3', 'Last3', NULL, NULL, false),
(4, 'user4@example.com', 'password4', 'First4', 'Last4', NULL, NULL, false),
(5, 'user5@example.com', 'password5', 'First5', 'Last5', NULL, NULL, true),
(6, 'user6@example.com', 'password6', 'First6', 'Last6', NULL, NULL, false),
(7, 'user7@example.com', 'password7', 'First7', 'Last7', NULL, NULL, false),
(8, 'user8@example.com', 'password8', 'First8', 'Last8', NULL, NULL, false),
(9, 'user9@example.com', 'password9', 'First9', 'Last9', NULL, NULL, false),
(10, 'user10@example.com', 'password10', 'First10', 'Last10', NULL, NULL, true),
(11, 'user11@example.com', 'password11', 'First11', 'Last11', NULL, NULL, false),
(12, 'user12@example.com', 'password12', 'First12', 'Last12', NULL, NULL, false),
(13, 'user13@example.com', 'password13', 'First13', 'Last13', NULL, NULL, false),
(14, 'user14@example.com', 'password14', 'First14', 'Last14', NULL, NULL, false),
(15, 'user15@example.com', 'password15', 'First15', 'Last15', NULL, NULL, true),
(16, 'user16@example.com', 'password16', 'First16', 'Last16', NULL, NULL, false),
(17, 'user17@example.com', 'password17', 'First17', 'Last17', NULL, NULL, false),
(18, 'user18@example.com', 'password18', 'First18', 'Last18', NULL, NULL, false),
(19, 'user19@example.com', 'password19', 'First19', 'Last19', NULL, NULL, false),
(20, 'user20@example.com', 'password20', 'First20', 'Last20', NULL, NULL, true),
(21, 'user21@example.com', 'password21', 'First21', 'Last21', NULL, NULL, false),
(22, 'user22@example.com', 'password22', 'First22', 'Last22', NULL, NULL, false),
(23, 'user23@example.com', 'password23', 'First23', 'Last23', NULL, NULL, false),
(24, 'user24@example.com', 'password24', 'First24', 'Last24', NULL, NULL, false),
(25, 'user25@example.com', 'password25', 'First25', 'Last25', NULL, NULL, true),
(26, 'user26@example.com', 'password26', 'First26', 'Last26', NULL, NULL, false),
(27, 'user27@example.com', 'password27', 'First27', 'Last27', NULL, NULL, false),
(28, 'user28@example.com', 'password28', 'First28', 'Last28', NULL, NULL, false),
(29, 'user29@example.com', 'password29', 'First29', 'Last29', NULL, NULL, false),
(30, 'user30@example.com', 'password30', 'First30', 'Last30', NULL, NULL, true),
(31, 'user31@example.com', 'password31', 'First31', 'Last31', NULL, NULL, false),
(32, 'user32@example.com', 'password32', 'First32', 'Last32', NULL, NULL, false),
(33, 'user33@example.com', 'password33', 'First33', 'Last33', NULL, NULL, false),
(34, 'user34@example.com', 'password34', 'First34', 'Last34', NULL, NULL, false),
(35, 'user35@example.com', 'password35', 'First35', 'Last35', NULL, NULL, true),
(36, 'user36@example.com', 'password36', 'First36', 'Last36', NULL, NULL, false),
(37, 'user37@example.com', 'password37', 'First37', 'Last37', NULL, NULL, false),
(38, 'user38@example.com', 'password38', 'First38', 'Last38', NULL, NULL, false),
(39, 'user39@example.com', 'password39', 'First39', 'Last39', NULL, NULL, false),
(40, 'user40@example.com', 'password40', 'First40', 'Last40', NULL, NULL, true),
(41, 'user41@example.com', 'password41', 'First41', 'Last41', NULL, NULL, false),
(42, 'user42@example.com', 'password42', 'First42', 'Last42', NULL, NULL, false),
(43, 'user43@example.com', 'password43', 'First43', 'Last43', NULL, NULL, false),
(44, 'user44@example.com', 'password44', 'First44', 'Last44', NULL, NULL, false),
(45, 'user45@example.com', 'password45', 'First45', 'Last45', NULL, NULL, true),
(46, 'user46@example.com', 'password46', 'First46', 'Last46', NULL, NULL, false),
(47, 'user47@example.com', 'password47', 'First47', 'Last47', NULL, NULL, false),
(48, 'user48@example.com', 'password48', 'First48', 'Last48', NULL, NULL, false),
(49, 'user49@example.com', 'password49', 'First49', 'Last49', NULL, NULL, false),
(50, 'user50@example.com', 'password50', 'First50', 'Last50', NULL, NULL, true);

-- ========================================
-- Hotel
-- ========================================
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(1,  'Hotel 1',  'https://example.com/hotel_default.png', 'Address 1',  'Atlanta, United States',             ((1 % 5) + 1),  '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(2,  'Hotel 2',  'https://example.com/hotel_default.png', 'Address 2',  'Beijing, China',                     ((2 % 5) + 1),  '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(3,  'Hotel 3',  'https://example.com/hotel_default.png', 'Address 3',  'Los Angeles, United States',        ((3 % 5) + 1),  '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(4,  'Hotel 4',  'https://example.com/hotel_default.png', 'Address 4',  'Dubai, United Arab Emirates',        ((4 % 5) + 1),  '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(5,  'Hotel 5',  'https://example.com/hotel_default.png', 'Address 5',  'Tokyo, Japan',                       ((5 % 5) + 1),  '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(6,  'Hotel 6',  'https://example.com/hotel_default.png', 'Address 6',  'Chicago, United States',             ((6 % 5) + 1),  '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(7,  'Hotel 7',  'https://example.com/hotel_default.png', 'Address 7',  'London, United Kingdom',             ((7 % 5) + 1),  '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(8,  'Hotel 8',  'https://example.com/hotel_default.png', 'Address 8',  'Houston, United States',             ((8 % 5) + 1),  '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(9,  'Hotel 9',  'https://example.com/hotel_default.png', 'Address 9',  'Dallas, United States',              ((9 % 5) + 1),  '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(10, 'Hotel 10', 'https://example.com/hotel_default.png', 'Address 10', 'Guangzhou, China',                   ((10 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(11, 'Hotel 11', 'https://example.com/hotel_default.png', 'Address 11', 'Amsterdam, Netherlands',           ((11 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(12, 'Hotel 12', 'https://example.com/hotel_default.png', 'Address 12', 'Frankfurt, Germany',               ((12 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(13, 'Hotel 13', 'https://example.com/hotel_default.png', 'Address 13', 'New York, United States',          ((13 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(14, 'Hotel 14', 'https://example.com/hotel_default.png', 'Address 14', 'Singapore, Singapore',             ((14 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(15, 'Hotel 15', 'https://example.com/hotel_default.png', 'Address 15', 'Toronto, Canada',                  ((15 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(16, 'Hotel 16', 'https://example.com/hotel_default.png', 'Address 16', 'Madrid, Spain',                    ((16 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(17, 'Hotel 17', 'https://example.com/hotel_default.png', 'Address 17', 'Seoul, South Korea',               ((17 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(18, 'Hotel 18', 'https://example.com/hotel_default.png', 'Address 18', 'Sydney, Australia',                ((18 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(19, 'Hotel 19', 'https://example.com/hotel_default.png', 'Address 19', 'Melbourne, Australia',             ((19 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(20, 'Hotel 20', 'https://example.com/hotel_default.png', 'Address 20', 'Bangkok, Thailand',                ((20 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(21, 'Hotel 21', 'https://example.com/hotel_default.png', 'Address 21', 'Brussels, Belgium',                ((21 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(22, 'Hotel 22', 'https://example.com/hotel_default.png', 'Address 22', 'Zurich, Switzerland',              ((22 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(23, 'Hotel 23', 'https://example.com/hotel_default.png', 'Address 23', 'Munich, Germany',                  ((23 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(24, 'Hotel 24', 'https://example.com/hotel_default.png', 'Address 24', 'Vienna, Austria',                  ((24 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(25, 'Hotel 25', 'https://example.com/hotel_default.png', 'Address 25', 'Istanbul, Turkey',                 ((25 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(26, 'Hotel 26', 'https://example.com/hotel_default.png', 'Address 26', 'Barcelona, Spain',               ((26 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(27, 'Hotel 27', 'https://example.com/hotel_default.png', 'Address 27', 'Paris, France',                  ((27 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(28, 'Hotel 28', 'https://example.com/hotel_default.png', 'Address 28', 'Rome, Italy',                    ((28 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(29, 'Hotel 29', 'https://example.com/hotel_default.png', 'Address 29', 'Seattle, United States',         ((29 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(30, 'Hotel 30', 'https://example.com/hotel_default.png', 'Address 30', 'Miami, United States',           ((30 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(31, 'Hotel 31', 'https://example.com/hotel_default.png', 'Address 31', 'Boston, United States',          ((31 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(32, 'Hotel 32', 'https://example.com/hotel_default.png', 'Address 32', 'Vancouver, Canada',              ((32 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(33, 'Hotel 33', 'https://example.com/hotel_default.png', 'Address 33', 'Phoenix, United States',         ((33 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(34, 'Hotel 34', 'https://example.com/hotel_default.png', 'Address 34', 'São Paulo, Brazil',              ((34 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(35, 'Hotel 35', 'https://example.com/hotel_default.png', 'Address 35', 'Buenos Aires, Argentina',        ((35 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(36, 'Hotel 36', 'https://example.com/hotel_default.png', 'Address 36', 'Moscow, Russia',                 ((36 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(37, 'Hotel 37', 'https://example.com/hotel_default.png', 'Address 37', 'New Delhi, India',               ((37 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(38, 'Hotel 38', 'https://example.com/hotel_default.png', 'Address 38', 'Jakarta, Indonesia',             ((38 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(39, 'Hotel 39', 'https://example.com/hotel_default.png', 'Address 39', 'Mexico City, Mexico',            ((39 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(40, 'Hotel 40', 'https://example.com/hotel_default.png', 'Address 40', 'Kuala Lumpur, Malaysia',         ((40 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(41, 'Hotel 41', 'https://example.com/hotel_default.png', 'Address 41', 'Manila, Philippines',            ((41 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(42, 'Hotel 42', 'https://example.com/hotel_default.png', 'Address 42', 'Mumbai, India',                  ((42 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(43, 'Hotel 43', 'https://example.com/hotel_default.png', 'Address 43', 'Cape Town, South Africa',        ((43 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(44, 'Hotel 44', 'https://example.com/hotel_default.png', 'Address 44', 'Dublin, Ireland',                ((44 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(45, 'Hotel 45', 'https://example.com/hotel_default.png', 'Address 45', 'Helsinki, Finland',              ((45 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(46, 'Hotel 46', 'https://example.com/hotel_default.png', 'Address 46', 'Oslo, Norway',                   ((46 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(47, 'Hotel 47', 'https://example.com/hotel_default.png', 'Address 47', 'Stockholm, Sweden',              ((47 % 5) + 1), '["https://example.com/hotel_default.png"]', 15);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(48, 'Hotel 48', 'https://example.com/hotel_default.png', 'Address 48', 'Copenhagen, Denmark',             ((48 % 5) + 1), '["https://example.com/hotel_default.png"]', 20);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(49, 'Hotel 49', 'https://example.com/hotel_default.png', 'Address 49', 'Lisbon, Portugal',               ((49 % 5) + 1), '["https://example.com/hotel_default.png"]', 5);
INSERT INTO Hotel (id, name, logo, address, location, starRating, images, ownerId) VALUES 
(50, 'Hotel 50', 'https://example.com/hotel_default.png', 'Address 50', 'Prague, Czech Republic',           ((50 % 5) + 1), '["https://example.com/hotel_default.png"]', 10);

-- ========================================
-- RoomType
-- ========================================
DO $$
DECLARE
  h INTEGER;
  r INTEGER;
  rt_id INTEGER := 0;
BEGIN
  FOR h IN 1..50 LOOP
    FOR r IN 1..2 LOOP
      rt_id := rt_id + 1;
      INSERT INTO "RoomType" (id, name, amenities, pricePerNight, images, currentAvailability, "hotelId")
      VALUES (
        rt_id,
        'Room Type ' || rt_id,
        'Amenity1, Amenity2',
        100 + 10 * rt_id,
        '["https://example.com/room_default.png"]',
        10 + rt_id,
        h
      );
    END LOOP;
  END LOOP;
END $$;

-- ========================================
-- RoomAvailabilityRecord
-- ========================================
DO $$
DECLARE
  rt INTEGER;
  d INTEGER;
  rec_id INTEGER := 0;
  base_date DATE := '2025-05-01';
BEGIN
  FOR rt IN 1..100 LOOP
    FOR d IN 0..4 LOOP
      rec_id := rec_id + 1;
      INSERT INTO "RoomAvailabilityRecord" (id, date, availability, "roomTypeId")
      VALUES (
        rec_id,
        base_date + d,
        5 + (rt % 10),
        rt
      );
    END LOOP;
  END LOOP;
END $$;