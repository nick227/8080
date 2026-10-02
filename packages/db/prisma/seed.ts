import { PrismaClient, MediaKind, MediaSource, ReactionType, RoomVisibility } from '@prisma/client';

const db = new PrismaClient();

// A pool of mock YouTube video IDs we can draw from
const YOUTUBE_IDS = [
  'dQw4w9WgXcQ', 'jNQXAC9IVRw', 'M7lc1UVf-VE', 'VBi1TqA5N2w', 'lJIrF4YjHfQ',
  'kJQP7kiw5Fk', '9bZkp7q19f0', 'fJ9rUzIMcZQ', '3JZ_D3ELwOQ', '2Vv-BfVoq4g',
  'RgKAFK5djSk', 'cGw1RGSzDkM', 'L_jWHffIx5E', '09R8_2nJtjg', 'Zi_XLOBDo_Y'
];

// The seed wipes every table. Refuse anything but a local dev/test database.
function assertSafeTarget() {
  const url = process.env.DATABASE_URL ?? '';
  const host = (() => { try { return new URL(url).hostname } catch { return '' } })();
  const local = host === 'localhost' || host === '127.0.0.1';
  if (process.env.NODE_ENV === 'production' || !local) {
    throw new Error(`Refusing to seed: it deletes all data. DATABASE_URL host "${host || 'unset'}" is not local (or NODE_ENV=production).`);
  }
}

async function main() {
  assertSafeTarget();
  console.log('🧹 Cleaning database...');
  await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 0;');
  await db.reaction.deleteMany();
  await db.item.deleteMany();
  await db.media.deleteMany();
  await db.message.deleteMany();
  await db.roomMember.deleteMany();
  await db.room.deleteMany();
  await db.session.deleteMany();
  await db.profile.deleteMany();
  await db.user.deleteMany();
  await db.$executeRawUnsafe('SET FOREIGN_KEY_CHECKS = 1;');

  console.log('👤 Creating users...');
  const users = await Promise.all([
    createTestUser('alice@example.com', 'Alice Adams', 'Alice'),
    createTestUser('bob@example.com', 'Bob Builder', 'Bob'),
    createTestUser('charlie@example.com', 'Charlie Chaplin', 'Charlie'),
    createTestUser('dave@example.com', 'Dave Dave', 'Dave'),
    createTestUser('eve@example.com', 'Eve Example', 'Eve')
  ]);

  console.log('🎬 Seeding Room 1 (Heavy YouTube Usage)...');
  await seedHeavyVideoRoom('Video Essays & Analysis', users);

  console.log('🎸 Seeding Room 2 (Heavy YouTube Usage)...');
  await seedHeavyVideoRoom('Music Production Techniques', users);

  console.log('🧪 Seeding Room 3 (Edge Cases)...');
  await seedEdgeCasesRoom('Edge Case Sandbox', users);

  console.log('✅ Seeding complete!');
}

async function createTestUser(email: string, displayName: string, seed: string) {
  return await db.user.create({
    data: {
      email,
      isGuest: false,
      passwordHash: 'hashed_password_mock',
      profile: {
        create: {
          displayName,
          avatarUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`
        }
      }
    }
  });
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

async function createRoom(title: string, users: any[]) {
  return await db.room.create({
    data: {
      title,
      topic: 'Testing',
      visibility: RoomVisibility.public,
      ownerId: users[0].id,
      members: {
        create: users.map((u, i) => ({ userId: u.id, role: i === 0 ? 'owner' : 'member' }))
      }
    }
  });
}

async function createYouTubeMessage(authorId: string, ytId: string, text?: string) {
  return await db.message.create({
    data: {
      authorId,
      text: text || `Check out this video!`,
      media: {
        create: {
          ownerId: authorId,
          kind: MediaKind.video,
          source: MediaSource.youtube,
          externalId: ytId,
          title: `YouTube Video ${ytId}`,
          mimeType: 'video/youtube',
          size: 0,
          duration: Math.floor(Math.random() * 600) + 60, // random duration 1-11 mins
        }
      }
    }
  });
}

async function createImageMessage(authorId: string, text?: string) {
  return await db.message.create({
    data: {
      authorId,
      text: text || 'Here is an image reference.',
      media: {
        create: {
          ownerId: authorId,
          kind: MediaKind.image,
          source: MediaSource.stored,
          storageKey: `mock/image-${Math.floor(Math.random() * 1000)}.png`,
          mimeType: 'image/png',
          size: 150000,
          title: 'mock-image.png',
        }
      }
    }
  });
}

async function createTextMessage(authorId: string, text: string) {
  return await db.message.create({
    data: { authorId, text }
  });
}

// ----------------------------------------------------------------------
// Room Seeds
// ----------------------------------------------------------------------

async function seedHeavyVideoRoom(title: string, users: any[]) {
  const thumb = await db.media.create({
    data: {
      ownerId: users[0].id,
      kind: MediaKind.image,
      source: MediaSource.youtube,
      externalId: YOUTUBE_IDS[0],
      title: 'Room Thumbnail',
      mimeType: 'image/jpeg',
      size: 0,
    }
  });

  const room = await db.room.create({
    data: {
      title,
      description: 'A comprehensive collection of video essays and deep dives into various topics. Explore different viewpoints and analysis from multiple contributors.',
      thumbnailId: thumb.id,
      visibility: RoomVisibility.public,
      ownerId: users[0].id,
      members: { create: users.map(u => ({ userId: u.id, role: 'member' })) }
    }
  });

  let itemCount = 0;
  
  // Create 9+ Videos
  const items: any[] = [];
  for (let i = 0; i < 10; i++) {
    const author = users[i % users.length];
    const ytId = YOUTUBE_IDS[i % YOUTUBE_IDS.length];
    
    const msg = await createYouTubeMessage(author.id, ytId, `Video contribution #${i + 1}`);
    itemCount++;
    
    // The first video is root, the rest might be replies to the root at different timestamps
    const isRoot = i === 0;
    const item = await db.item.create({
      data: {
        roomId: room.id,
        messageId: msg.id,
        number: itemCount,
        parentId: isRoot ? undefined : items[0].id,
        anchorStartMs: isRoot ? undefined : (i * 30000), // Reply at 30s intervals of the root video
      }
    });
    items.push(item);
  }

  // Create 3 Images scattered as nested replies
  for (let i = 0; i < 3; i++) {
    const author = users[(i + 1) % users.length];
    const msg = await createImageMessage(author.id, `This image illustrates my point for video ${i + 1}`);
    itemCount++;
    await db.item.create({
      data: {
        roomId: room.id,
        messageId: msg.id,
        number: itemCount,
        parentId: items[i + 1].id, // Nested reply to a sub-video
      }
    });
  }

  // Create 3 Text comments
  for (let i = 0; i < 3; i++) {
    const author = users[(i + 2) % users.length];
    const msg = await createTextMessage(author.id, `Great points all around! Just leaving a text comment here. ${i}`);
    itemCount++;
    await db.item.create({
      data: {
        roomId: room.id,
        messageId: msg.id,
        number: itemCount,
        parentId: items[0].id, // Direct reply to root
        anchorStartMs: 5000 // At 5 seconds
      }
    });
  }

  await db.room.update({ where: { id: room.id }, data: { itemCount } });
}

async function seedEdgeCasesRoom(title: string, users: any[]) {
  const thumb = await db.media.create({
    data: {
      ownerId: users[0].id,
      kind: MediaKind.image,
      source: MediaSource.youtube,
      externalId: YOUTUBE_IDS[2],
      title: 'Room Thumbnail',
      mimeType: 'image/jpeg',
      size: 0,
    }
  });

  const room = await db.room.create({
    data: {
      title,
      description: 'A sandbox room to test how the UI handles edge cases like long text, deep nesting, and bizarre media attachments.',
      thumbnailId: thumb.id,
      visibility: RoomVisibility.public,
      ownerId: users[0].id,
      members: { create: users.map(u => ({ userId: u.id, role: 'member' })) }
    }
  });

  let itemCount = 0;
  
  // Edge Case 1: Extremely long text message
  const longText = 'A '.repeat(5000); 
  const msg1 = await createTextMessage(users[0].id, `Extremely long text: ${longText}`);
  itemCount++;
  const item1 = await db.item.create({ data: { roomId: room.id, messageId: msg1.id, number: itemCount } });

  // Edge Case 2: Deeply nested thread (A -> B -> C -> D -> E)
  let parentId = item1.id;
  for (let i = 0; i < 5; i++) {
    const msg = await createTextMessage(users[i % users.length].id, `Deep nest level ${i + 1}`);
    itemCount++;
    const item = await db.item.create({ data: { roomId: room.id, messageId: msg.id, number: itemCount, parentId } });
    parentId = item.id;
  }

  // Edge Case 3: Video with missing title/text and strange duration
  const weirdVideoMsg = await db.message.create({
    data: {
      authorId: users[1].id,
      text: null, // No text
      media: {
        create: {
          ownerId: users[1].id,
          kind: MediaKind.video,
          source: MediaSource.youtube,
          externalId: 'dQw4w9WgXcQ',
          title: null, // No title
          mimeType: 'video/youtube',
          size: 0,
          duration: 0.1, // extremely short
        }
      }
    }
  });
  itemCount++;
  const weirdVideoItem = await db.item.create({ data: { roomId: room.id, messageId: weirdVideoMsg.id, number: itemCount } });

  // Edge Case 4: Message with a ton of reactions
  await db.reaction.createMany({
    data: users.flatMap(u => [
      { itemId: weirdVideoItem.id, userId: u.id, type: ReactionType.like },
      { itemId: weirdVideoItem.id, userId: u.id, type: ReactionType.ack },
      { itemId: weirdVideoItem.id, userId: u.id, type: ReactionType.laugh }
    ])
  });

  await db.room.update({ where: { id: room.id }, data: { itemCount } });
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
