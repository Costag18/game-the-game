// Shared content for the social-deduction games (Spyfall, Chameleon Clues).
// Sketch Impostor reuses server/src/utils/wordBank.js; Traitor's Vault and
// Whisper Network are mechanic-driven and need no data.

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---- Spyfall: { location, roles:[...] }. Everyone gets the location + a role except the spy. ----
export const SPYFALL_LOCATIONS = [
  { location: 'Airplane', roles: ['Pilot', 'Flight Attendant', 'Passenger', 'Air Marshal', 'Mechanic', 'Co-pilot'] },
  { location: 'Beach', roles: ['Lifeguard', 'Surfer', 'Tourist', 'Ice Cream Vendor', 'Photographer', 'Sunbather'] },
  { location: 'Casino', roles: ['Dealer', 'Bouncer', 'Gambler', 'Bartender', 'Manager', 'Cocktail Waiter'] },
  { location: 'Hospital', roles: ['Surgeon', 'Nurse', 'Patient', 'Receptionist', 'Janitor', 'Paramedic'] },
  { location: 'Restaurant', roles: ['Chef', 'Waiter', 'Customer', 'Host', 'Dishwasher', 'Food Critic'] },
  { location: 'School', roles: ['Teacher', 'Principal', 'Student', 'Janitor', 'Librarian', 'Cafeteria Worker'] },
  { location: 'Space Station', roles: ['Astronaut', 'Mission Commander', 'Scientist', 'Engineer', 'Stowaway', 'Robot'] },
  { location: 'Pirate Ship', roles: ['Captain', 'First Mate', 'Cook', 'Cabin Boy', 'Gunner', 'Prisoner'] },
  { location: 'Movie Studio', roles: ['Director', 'Actor', 'Cameraman', 'Stunt Double', 'Makeup Artist', 'Producer'] },
  { location: 'Bank', roles: ['Teller', 'Manager', 'Customer', 'Security Guard', 'Robber', 'Loan Officer'] },
  { location: 'Zoo', roles: ['Zookeeper', 'Veterinarian', 'Visitor', 'Ticket Seller', 'Tour Guide', 'Janitor'] },
  { location: 'Cruise Ship', roles: ['Captain', 'Entertainer', 'Passenger', 'Waiter', 'Lifeguard', 'Engineer'] },
  { location: 'Theater', roles: ['Actor', 'Director', 'Usher', 'Audience Member', 'Stagehand', 'Critic'] },
  { location: 'Submarine', roles: ['Captain', 'Sonar Operator', 'Engineer', 'Cook', 'Navigator', 'Torpedo Officer'] },
  { location: 'Carnival', roles: ['Ride Operator', 'Clown', 'Visitor', 'Ticket Seller', 'Booth Worker', 'Fortune Teller'] },
  { location: 'Ski Resort', roles: ['Instructor', 'Lift Operator', 'Tourist', 'Rescuer', 'Bartender', 'Snowboarder'] },
];

// ---- Chameleon: { theme, words:[16] } shown as a 4x4 grid. Everyone but the chameleon
// learns which cell is the secret word; clues must hint it without being too obvious. ----
export const CHAMELEON_GRIDS = [
  { theme: 'Animals', words: ['Lion', 'Tiger', 'Bear', 'Wolf', 'Fox', 'Deer', 'Rabbit', 'Mouse', 'Eagle', 'Owl', 'Shark', 'Whale', 'Snake', 'Frog', 'Horse', 'Cow'] },
  { theme: 'Foods', words: ['Pizza', 'Burger', 'Sushi', 'Pasta', 'Taco', 'Salad', 'Soup', 'Steak', 'Bread', 'Cheese', 'Apple', 'Banana', 'Cake', 'Cookie', 'Rice', 'Egg'] },
  { theme: 'Sports', words: ['Soccer', 'Tennis', 'Golf', 'Boxing', 'Swimming', 'Cycling', 'Skiing', 'Hockey', 'Cricket', 'Rugby', 'Baseball', 'Surfing', 'Archery', 'Bowling', 'Fencing', 'Rowing'] },
  { theme: 'Jobs', words: ['Doctor', 'Teacher', 'Chef', 'Pilot', 'Artist', 'Farmer', 'Lawyer', 'Nurse', 'Plumber', 'Actor', 'Writer', 'Banker', 'Dentist', 'Soldier', 'Barber', 'Judge'] },
  { theme: 'Countries', words: ['France', 'Japan', 'Brazil', 'Egypt', 'Canada', 'India', 'Italy', 'Spain', 'Kenya', 'Mexico', 'China', 'Norway', 'Peru', 'Greece', 'Cuba', 'Chile'] },
  { theme: 'Weather', words: ['Rain', 'Snow', 'Sunny', 'Storm', 'Fog', 'Wind', 'Hail', 'Frost', 'Cloudy', 'Thunder', 'Rainbow', 'Drizzle', 'Heatwave', 'Breeze', 'Blizzard', 'Sleet'] },
  { theme: 'Instruments', words: ['Piano', 'Guitar', 'Violin', 'Drums', 'Flute', 'Trumpet', 'Cello', 'Harp', 'Saxophone', 'Clarinet', 'Banjo', 'Tuba', 'Oboe', 'Accordion', 'Ukulele', 'Organ'] },
  { theme: 'Transport', words: ['Car', 'Bus', 'Train', 'Plane', 'Boat', 'Bicycle', 'Scooter', 'Helicopter', 'Truck', 'Tram', 'Ferry', 'Taxi', 'Motorcycle', 'Subway', 'Rocket', 'Skateboard'] },
  { theme: 'Space', words: ['Planet', 'Star', 'Moon', 'Comet', 'Galaxy', 'Asteroid', 'Nebula', 'Satellite', 'Rocket', 'Astronaut', 'Telescope', 'Orbit', 'Meteor', 'Sun', 'Eclipse', 'Alien'] },
  { theme: 'Kitchen', words: ['Knife', 'Fork', 'Spoon', 'Plate', 'Cup', 'Pot', 'Pan', 'Oven', 'Fridge', 'Toaster', 'Kettle', 'Blender', 'Bowl', 'Whisk', 'Grater', 'Ladle'] },
  { theme: 'Movies', words: ['Hero', 'Villain', 'Sequel', 'Trailer', 'Director', 'Popcorn', 'Oscar', 'Sidekick', 'Plot Twist', 'Cameo', 'Soundtrack', 'Premiere', 'Stunt', 'Ending', 'Remake', 'Cliffhanger'] },
  { theme: 'Body', words: ['Head', 'Hand', 'Foot', 'Elbow', 'Knee', 'Shoulder', 'Nose', 'Ear', 'Eye', 'Mouth', 'Finger', 'Toe', 'Ankle', 'Wrist', 'Chin', 'Heel'] },
];

function pick(list, n) { return shuffle(list).slice(0, n); }
export function pickLocation() { return pick(SPYFALL_LOCATIONS, 1)[0]; }
export function pickLocations(n = 1) { return pick(SPYFALL_LOCATIONS, n); }
export function pickGrid() { return pick(CHAMELEON_GRIDS, 1)[0]; }
export function pickGrids(n = 1) { return pick(CHAMELEON_GRIDS, n); }
export { shuffle };
