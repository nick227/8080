const fs = require('fs');
const file = '/home/administrator/web/voice-chat-v1/apps/web/src/features/vbg/maskSource.ts';
let content = fs.readFileSync(file, 'utf8');

if (!content.includes('if (wanted() === 
