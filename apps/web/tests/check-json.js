import fs from 'fs'
const d = JSON.parse(fs.readFileSync('/mnt/c/Users/Administrator/Downloads/vbg-synchronized-frame.json', 'utf8'))
console.log('Keys:', Object.keys(d))
if (d.cameraFrame) console.log('cameraFrame type:', typeof d.cameraFrame, 'slice:', String(d.cameraFrame).slice(0, 50))
if (d.original) console.log('original type:', typeof d.original, 'slice:', String(d.original).slice(0, 50))
if (d.modelInput) console.log('modelInput type:', typeof d.modelInput, 'len:', d.modelInput.length)
