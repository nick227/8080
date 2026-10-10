import fs from 'fs'
const d = JSON.parse(fs.readFileSync('/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json', 'utf8'))
console.log('width:', d.width, 'height:', d.height, 'rawAlpha length:', d.rawAlpha.length)
