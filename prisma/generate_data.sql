TRUNCATE TABLE "Airport", "City", "HotelReservation", "Hotel", "Itinerary", "Notification", "RoomAvailabilityRecord", "RoomType", "User", "FlightReservation" RESTART IDENTITY CASCADE;

INSERT INTO "City" ("name", "country") VALUES ('Atlanta', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('Beijing', 'China');
INSERT INTO "City" ("name", "country") VALUES ('Los Angeles', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('Dubai', 'United Arab Emirates');
INSERT INTO "City" ("name", "country") VALUES ('Tokyo', 'Japan');
INSERT INTO "City" ("name", "country") VALUES ('Chicago', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('London', 'United Kingdom');
INSERT INTO "City" ("name", "country") VALUES ('Houston', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('Dallas', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('Guangzhou', 'China');
INSERT INTO "City" ("name", "country") VALUES ('Amsterdam', 'Netherlands');
INSERT INTO "City" ("name", "country") VALUES ('Frankfurt', 'Germany');
INSERT INTO "City" ("name", "country") VALUES ('New York', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('Singapore', 'Singapore');
INSERT INTO "City" ("name", "country") VALUES ('Toronto', 'Canada');
INSERT INTO "City" ("name", "country") VALUES ('Madrid', 'Spain');
INSERT INTO "City" ("name", "country") VALUES ('Seoul', 'South Korea');
INSERT INTO "City" ("name", "country") VALUES ('Sydney', 'Australia');
INSERT INTO "City" ("name", "country") VALUES ('Melbourne', 'Australia');
INSERT INTO "City" ("name", "country") VALUES ('Bangkok', 'Thailand');
INSERT INTO "City" ("name", "country") VALUES ('Brussels', 'Belgium');
INSERT INTO "City" ("name", "country") VALUES ('Zurich', 'Switzerland');
INSERT INTO "City" ("name", "country") VALUES ('Munich', 'Germany');
INSERT INTO "City" ("name", "country") VALUES ('Vienna', 'Austria');
INSERT INTO "City" ("name", "country") VALUES ('Istanbul', 'Turkey');
INSERT INTO "City" ("name", "country") VALUES ('Barcelona', 'Spain');
INSERT INTO "City" ("name", "country") VALUES ('Paris', 'France');
INSERT INTO "City" ("name", "country") VALUES ('Rome', 'Italy');
INSERT INTO "City" ("name", "country") VALUES ('Seattle', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('Miami', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('Boston', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('Vancouver', 'Canada');
INSERT INTO "City" ("name", "country") VALUES ('Phoenix', 'United States');
INSERT INTO "City" ("name", "country") VALUES ('São Paulo', 'Brazil');
INSERT INTO "City" ("name", "country") VALUES ('Buenos Aires', 'Argentina');
INSERT INTO "City" ("name", "country") VALUES ('Moscow', 'Russia');
INSERT INTO "City" ("name", "country") VALUES ('New Delhi', 'India');
INSERT INTO "City" ("name", "country") VALUES ('Jakarta', 'Indonesia');
INSERT INTO "City" ("name", "country") VALUES ('Mexico City', 'Mexico');
INSERT INTO "City" ("name", "country") VALUES ('Kuala Lumpur', 'Malaysia');
INSERT INTO "City" ("name", "country") VALUES ('Manila', 'Philippines');
INSERT INTO "City" ("name", "country") VALUES ('Mumbai', 'India');
INSERT INTO "City" ("name", "country") VALUES ('Cape Town', 'South Africa');
INSERT INTO "City" ("name", "country") VALUES ('Dublin', 'Ireland');
INSERT INTO "City" ("name", "country") VALUES ('Helsinki', 'Finland');
INSERT INTO "City" ("name", "country") VALUES ('Oslo', 'Norway');
INSERT INTO "City" ("name", "country") VALUES ('Stockholm', 'Sweden');
INSERT INTO "City" ("name", "country") VALUES ('Copenhagen', 'Denmark');
INSERT INTO "City" ("name", "country") VALUES ('Lisbon', 'Portugal');
INSERT INTO "City" ("name", "country") VALUES ('Prague', 'Czech Republic');

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('98b57d5f-ebd6-4102-864d-76568e843aee', 'ATL', 'Hartsfield–Jackson Atlanta International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Atlanta'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('3dfbf270-f8e8-4fe0-a431-4856aa5fa7a3', 'PEK', 'Beijing Capital International Airport', 'China', (SELECT id FROM "City" WHERE "name" = 'Beijing'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('de904db1-32ec-4e34-814d-eca3c89e0dd7', 'LAX', 'Los Angeles International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Los Angeles'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('56b2b45e-0d96-481a-befe-2f04acc72d77', 'DXB', 'Dubai International Airport', 'United Arab Emirates', (SELECT id FROM "City" WHERE "name" = 'Dubai'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('5b167997-009a-4f1b-bbee-77f99b74ef59', 'HND', 'Tokyo Haneda Airport', 'Japan', (SELECT id FROM "City" WHERE "name" = 'Tokyo'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('39b4c9c0-507a-45c0-9c3c-6fea96c61aaa', 'ORD', 'O''Hare International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Chicago'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('64848eb5-ba4e-4e82-a6c0-641f378e140b', 'LHR', 'Heathrow Airport', 'United Kingdom', (SELECT id FROM "City" WHERE "name" = 'London'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('758f2b3d-802b-40fa-b0b6-6d4f6cf4c949', 'IAH', 'George Bush Intercontinental Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Houston'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('ea6479b3-1f8f-4bb9-be12-e87264dfb2dc', 'DFW', 'Dallas/Fort Worth International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Dallas'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('d3ef285a-7668-4d91-8925-a23be1a0c94b', 'CAN', 'Guangzhou Baiyun International Airport', 'China', (SELECT id FROM "City" WHERE "name" = 'Guangzhou'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('3bb318ef-7f81-4c10-98d7-1a67b80944b8', 'AMS', 'Amsterdam Airport Schiphol', 'Netherlands', (SELECT id FROM "City" WHERE "name" = 'Amsterdam'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('e93398e2-483d-408c-8a05-687fed53787c', 'FRA', 'Frankfurt Airport', 'Germany', (SELECT id FROM "City" WHERE "name" = 'Frankfurt'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('b7e29a55-80ab-4405-a23a-a927dcadfe2d', 'JFK', 'John F. Kennedy International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'New York'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('02ab893c-5a39-4524-95bb-508eb41dcc45', 'SIN', 'Singapore Changi Airport', 'Singapore', (SELECT id FROM "City" WHERE "name" = 'Singapore'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('370d2633-ba94-47f5-a735-513c0e332224', 'YYZ', 'Toronto Pearson International Airport', 'Canada', (SELECT id FROM "City" WHERE "name" = 'Toronto'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('a8a830e1-74cb-4927-a86c-9ea23a2db204', 'MAD', 'Adolfo Suárez Madrid-Barajas Airport', 'Spain', (SELECT id FROM "City" WHERE "name" = 'Madrid'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('bb984fc3-de7d-4908-862d-ebe85758394b', 'ICN', 'Incheon International Airport', 'South Korea', (SELECT id FROM "City" WHERE "name" = 'Seoul'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('d1febfc6-d951-41b8-b07e-6e5e4ef144f9', 'SYD', 'Sydney Kingsford Smith Airport', 'Australia', (SELECT id FROM "City" WHERE "name" = 'Sydney'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('b48462d8-96a0-4a52-83de-08975938e9e4', 'MEL', 'Melbourne Airport', 'Australia', (SELECT id FROM "City" WHERE "name" = 'Melbourne'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('068bcee7-3192-453d-a3fb-6d84b87e39f6', 'BKK', 'Suvarnabhumi Airport', 'Thailand', (SELECT id FROM "City" WHERE "name" = 'Bangkok'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('bc00dbe4-3640-4592-b1b4-84f80398f9bb', 'BRU', 'Brussels Airport', 'Belgium', (SELECT id FROM "City" WHERE "name" = 'Brussels'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('2bcb7925-96aa-4de8-9ec1-3622e954c0b6', 'ZRH', 'Zurich Airport', 'Switzerland', (SELECT id FROM "City" WHERE "name" = 'Zurich'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('34478814-4a31-4f7d-baef-d6de0901ff20', 'MUC', 'Munich Airport', 'Germany', (SELECT id FROM "City" WHERE "name" = 'Munich'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('a2224dd3-9fed-47d8-a0b2-8ecb0994cbc4', 'VIE', 'Vienna International Airport', 'Austria', (SELECT id FROM "City" WHERE "name" = 'Vienna'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('6177b97e-962d-4ac1-928f-cdc71f3d1a0a', 'IST', 'Istanbul Airport', 'Turkey', (SELECT id FROM "City" WHERE "name" = 'Istanbul'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('295296f3-8307-4bc1-b5b9-d40db4f543a4', 'BCN', 'Barcelona–El Prat Airport', 'Spain', (SELECT id FROM "City" WHERE "name" = 'Barcelona'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('fa35cff2-4d06-4933-9e2b-b3f329253b48', 'CDG', 'Charles de Gaulle Airport', 'France', (SELECT id FROM "City" WHERE "name" = 'Paris'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('9619bf1f-5e1c-4955-9e38-28488a560333', 'FCO', 'Leonardo da Vinci–Fiumicino Airport', 'Italy', (SELECT id FROM "City" WHERE "name" = 'Rome'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('92bdf26d-ff09-45fa-a469-8a74e0059312', 'SEA', 'Seattle-Tacoma International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Seattle'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('135dd017-bd88-415f-80d8-1ae9d8804246', 'MIA', 'Miami International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Miami'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('98cd3a74-3c80-487b-8ab5-ee6bdf5692e6', 'BOS', 'Logan International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Boston'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('277ee046-765d-4546-aba7-0e4ec715daae', 'YVR', 'Vancouver International Airport', 'Canada', (SELECT id FROM "City" WHERE "name" = 'Vancouver'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('c8f1917e-ff36-40b4-a6be-ac4bc516571e', 'PHX', 'Phoenix Sky Harbor International Airport', 'United States', (SELECT id FROM "City" WHERE "name" = 'Phoenix'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('259f1ae6-cc50-4917-aeaa-5129c12644a2', 'GRU', 'São Paulo/Guarulhos International Airport', 'Brazil', (SELECT id FROM "City" WHERE "name" = 'São Paulo'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('08354f84-0200-4039-bb9f-171938367a23', 'EZE', 'Ministro Pistarini International Airport', 'Argentina', (SELECT id FROM "City" WHERE "name" = 'Buenos Aires'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('c3fe9f8c-9103-40b2-8d63-68096214f07c', 'SVO', 'Sheremetyevo International Airport', 'Russia', (SELECT id FROM "City" WHERE "name" = 'Moscow'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('7e1ba9b7-dff7-47cd-8275-ae214e4e2f1b', 'DEL', 'Indira Gandhi International Airport', 'India', (SELECT id FROM "City" WHERE "name" = 'New Delhi'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('798155b0-a5a3-4ffd-b342-fb188bbcf18b', 'CGK', 'Soekarno–Hatta International Airport', 'Indonesia', (SELECT id FROM "City" WHERE "name" = 'Jakarta'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('7ec62a84-f3de-4817-8314-bdbdc9d3ced9', 'MEX', 'Mexico City International Airport', 'Mexico', (SELECT id FROM "City" WHERE "name" = 'Mexico City'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('63cea601-895c-4d63-bf1e-746b604f3ff7', 'KUL', 'Kuala Lumpur International Airport', 'Malaysia', (SELECT id FROM "City" WHERE "name" = 'Kuala Lumpur'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('061fc0c6-d34e-4de1-8e08-8297d5e9b7de', 'MNL', 'Ninoy Aquino International Airport', 'Philippines', (SELECT id FROM "City" WHERE "name" = 'Manila'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('8999a15a-7542-4141-bac4-c8c76d98957d', 'BOM', 'Chhatrapati Shivaji Maharaj International Airport', 'India', (SELECT id FROM "City" WHERE "name" = 'Mumbai'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('57528dee-c1b1-49cf-8e07-961ae9fdd969', 'CPT', 'Cape Town International Airport', 'South Africa', (SELECT id FROM "City" WHERE "name" = 'Cape Town'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('344ea7c4-b4d9-49bc-90a8-d4dffce754d5', 'DUB', 'Dublin Airport', 'Ireland', (SELECT id FROM "City" WHERE "name" = 'Dublin'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('54ed1ab1-9895-4ab3-9f82-8870e984f410', 'HEL', 'Helsinki Airport', 'Finland', (SELECT id FROM "City" WHERE "name" = 'Helsinki'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('98cdc75f-7195-4b59-a583-f07a3711ddf5', 'OSL', 'Oslo Gardermoen Airport', 'Norway', (SELECT id FROM "City" WHERE "name" = 'Oslo'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('7d3cd81e-5b33-4235-aa4a-8955237e729b', 'ARN', 'Stockholm Arlanda Airport', 'Sweden', (SELECT id FROM "City" WHERE "name" = 'Stockholm'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('ad66db9f-c421-4076-93c6-78be0e165fa7', 'CPH', 'Copenhagen Airport', 'Denmark', (SELECT id FROM "City" WHERE "name" = 'Copenhagen'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('00d50809-fe27-446c-8b80-84ab2955eb1e', 'LIS', 'Lisbon Humberto Delgado Airport', 'Portugal', (SELECT id FROM "City" WHERE "name" = 'Lisbon'));

INSERT INTO "Airport" ("externalId", "code", "name", "country", "cityId") VALUES 
('2d343a42-595c-4bdc-a75c-e5c6cd4eeda7', 'PRG', 'Václav Havel Airport Prague', 'Czech Republic', (SELECT id FROM "City" WHERE "name" = 'Prague'));


INSERT INTO "User" ("email", "password", "firstName", "lastName", "profilePic", "phone", "IsHotelOwner") VALUES 
('user1@example.com', 'password1', 'First1', 'Last1', NULL, NULL, false),
('user2@example.com', 'password2', 'First2', 'Last2', NULL, NULL, false),
('user3@example.com', 'password3', 'First3', 'Last3', NULL, NULL, false),
('user4@example.com', 'password4', 'First4', 'Last4', NULL, NULL, false),
('user5@example.com', 'password5', 'First5', 'Last5', NULL, NULL, true),
('user6@example.com', 'password6', 'First6', 'Last6', NULL, NULL, false),
('user7@example.com', 'password7', 'First7', 'Last7', NULL, NULL, false),
('user8@example.com', 'password8', 'First8', 'Last8', NULL, NULL, false),
('user9@example.com', 'password9', 'First9', 'Last9', NULL, NULL, false),
('user10@example.com', 'password10', 'First10', 'Last10', NULL, NULL, true),
('user11@example.com', 'password11', 'First11', 'Last11', NULL, NULL, false),
('user12@example.com', 'password12', 'First12', 'Last12', NULL, NULL, false),
('user13@example.com', 'password13', 'First13', 'Last13', NULL, NULL, false),
('user14@example.com', 'password14', 'First14', 'Last14', NULL, NULL, false),
('user15@example.com', 'password15', 'First15', 'Last15', NULL, NULL, true),
('user16@example.com', 'password16', 'First16', 'Last16', NULL, NULL, false),
('user17@example.com', 'password17', 'First17', 'Last17', NULL, NULL, false),
('user18@example.com', 'password18', 'First18', 'Last18', NULL, NULL, false),
('user19@example.com', 'password19', 'First19', 'Last19', NULL, NULL, false),
('user20@example.com', 'password20', 'First20', 'Last20', NULL, NULL, true),
('user21@example.com', 'password21', 'First21', 'Last21', NULL, NULL, false),
('user22@example.com', 'password22', 'First22', 'Last22', NULL, NULL, false),
('user23@example.com', 'password23', 'First23', 'Last23', NULL, NULL, false),
('user24@example.com', 'password24', 'First24', 'Last24', NULL, NULL, false),
('user25@example.com', 'password25', 'First25', 'Last25', NULL, NULL, true),
('user26@example.com', 'password26', 'First26', 'Last26', NULL, NULL, false),
('user27@example.com', 'password27', 'First27', 'Last27', NULL, NULL, false),
('user28@example.com', 'password28', 'First28', 'Last28', NULL, NULL, false),
('user29@example.com', 'password29', 'First29', 'Last29', NULL, NULL, false),
('user30@example.com', 'password30', 'First30', 'Last30', NULL, NULL, true),
('user31@example.com', 'password31', 'First31', 'Last31', NULL, NULL, false),
('user32@example.com', 'password32', 'First32', 'Last32', NULL, NULL, false),
('user33@example.com', 'password33', 'First33', 'Last33', NULL, NULL, false),
('user34@example.com', 'password34', 'First34', 'Last34', NULL, NULL, false),
('user35@example.com', 'password35', 'First35', 'Last35', NULL, NULL, true),
('user36@example.com', 'password36', 'First36', 'Last36', NULL, NULL, false),
('user37@example.com', 'password37', 'First37', 'Last37', NULL, NULL, false),
('user38@example.com', 'password38', 'First38', 'Last38', NULL, NULL, false),
('user39@example.com', 'password39', 'First39', 'Last39', NULL, NULL, false),
('user40@example.com', 'password40', 'First40', 'Last40', NULL, NULL, true),
('user41@example.com', 'password41', 'First41', 'Last41', NULL, NULL, false),
('user42@example.com', 'password42', 'First42', 'Last42', NULL, NULL, false),
('user43@example.com', 'password43', 'First43', 'Last43', NULL, NULL, false),
('user44@example.com', 'password44', 'First44', 'Last44', NULL, NULL, false),
('user45@example.com', 'password45', 'First45', 'Last45', NULL, NULL, true),
('user46@example.com', 'password46', 'First46', 'Last46', NULL, NULL, false),
('user47@example.com', 'password47', 'First47', 'Last47', NULL, NULL, false),
('user48@example.com', 'password48', 'First48', 'Last48', NULL, NULL, false),
('user49@example.com', 'password49', 'First49', 'Last49', NULL, NULL, false),
('user50@example.com', 'password50', 'First50', 'Last50', NULL, NULL, true);

DO $$
DECLARE
  h INTEGER;
  total_users INTEGER;
  owner_id INTEGER;
BEGIN

  SELECT count(*) INTO total_users FROM "User";
  IF total_users = 0 THEN
    RAISE EXCEPTION 'No users found in "User" table';
  END IF;
  
  FOR h IN 1..50 LOOP

    SELECT id INTO owner_id 
    FROM "User"
    ORDER BY id
    LIMIT 1 OFFSET ((h - 1) % total_users);
    
    INSERT INTO "Hotel" (name, logo, address, location, "starRating", images, "ownerId")
    VALUES (
      'Hotel ' || h,
      '/hotel-logo-default.svg',
      'Address ' || h,
      CASE 
         WHEN h = 1 THEN 'Atlanta, United States'
         WHEN h = 2 THEN 'Beijing, China'
         WHEN h = 3 THEN 'Los Angeles, United States'
         WHEN h = 4 THEN 'Dubai, United Arab Emirates'
         WHEN h = 5 THEN 'Tokyo, Japan'
         WHEN h = 6 THEN 'Chicago, United States'
         WHEN h = 7 THEN 'London, United Kingdom'
         WHEN h = 8 THEN 'Houston, United States'
         WHEN h = 9 THEN 'Dallas, United States'
         WHEN h = 10 THEN 'Guangzhou, China'
         WHEN h = 11 THEN 'Amsterdam, Netherlands'
         WHEN h = 12 THEN 'Frankfurt, Germany'
         WHEN h = 13 THEN 'New York, United States'
         WHEN h = 14 THEN 'Singapore, Singapore'
         WHEN h = 15 THEN 'Toronto, Canada'
         WHEN h = 16 THEN 'Madrid, Spain'
         WHEN h = 17 THEN 'Seoul, South Korea'
         WHEN h = 18 THEN 'Sydney, Australia'
         WHEN h = 19 THEN 'Melbourne, Australia'
         WHEN h = 20 THEN 'Bangkok, Thailand'
         WHEN h = 21 THEN 'Brussels, Belgium'
         WHEN h = 22 THEN 'Zurich, Switzerland'
         WHEN h = 23 THEN 'Munich, Germany'
         WHEN h = 24 THEN 'Vienna, Austria'
         WHEN h = 25 THEN 'Istanbul, Turkey'
         WHEN h = 26 THEN 'Barcelona, Spain'
         WHEN h = 27 THEN 'Paris, France'
         WHEN h = 28 THEN 'Rome, Italy'
         WHEN h = 29 THEN 'Seattle, United States'
         WHEN h = 30 THEN 'Miami, United States'
         WHEN h = 31 THEN 'Boston, United States'
         WHEN h = 32 THEN 'Vancouver, Canada'
         WHEN h = 33 THEN 'Phoenix, United States'
         WHEN h = 34 THEN 'São Paulo, Brazil'
         WHEN h = 35 THEN 'Buenos Aires, Argentina'
         WHEN h = 36 THEN 'Moscow, Russia'
         WHEN h = 37 THEN 'New Delhi, India'
         WHEN h = 38 THEN 'Jakarta, Indonesia'
         WHEN h = 39 THEN 'Mexico City, Mexico'
         WHEN h = 40 THEN 'Kuala Lumpur, Malaysia'
         WHEN h = 41 THEN 'Manila, Philippines'
         WHEN h = 42 THEN 'Mumbai, India'
         WHEN h = 43 THEN 'Cape Town, South Africa'
         WHEN h = 44 THEN 'Dublin, Ireland'
         WHEN h = 45 THEN 'Helsinki, Finland'
         WHEN h = 46 THEN 'Oslo, Norway'
         WHEN h = 47 THEN 'Stockholm, Sweden'
         WHEN h = 48 THEN 'Copenhagen, Denmark'
         WHEN h = 49 THEN 'Lisbon, Portugal'
         WHEN h = 50 THEN 'Prague, Czech Republic'
         ELSE 'Location ' || h
      END,
      ((h % 5) + 1),
      '[]',
      owner_id
    );
  END LOOP;
END $$;

DO $$
DECLARE
  hotel_rec RECORD;
  r INTEGER;
BEGIN
  FOR hotel_rec IN 
    SELECT id FROM "Hotel" ORDER BY id
  LOOP
    FOR r IN 1..2 LOOP
      INSERT INTO "RoomType" ("name", amenities, "pricePerNight", images, "currentAvailability", "hotelId")
      VALUES (
        'Room Type ' || hotel_rec.id || '-' || r,
        'Amenity1, Amenity2',
        100 + 10 * ((hotel_rec.id * 2) + r),
        '["https://example.com/room_default.png"]',
        10 + ((hotel_rec.id * 2) + r),
        hotel_rec.id
      );
    END LOOP;
  END LOOP;
END $$;