import { create } from 'zustand'

const KEY = '8080.device'

export type DeviceKind = 'audioinput' | 'videoinput'

export type DeviceChoice = {
  deviceId: string
  kind: DeviceKind
  label: string
}

// Video first; a device without a camera drops to the microphone (see below).
const FALLBACK: DeviceChoice = { deviceId: '', kind: 'videoinput', label: 'Camera' }
const MIC: DeviceChoice = { deviceId: '', kind: 'audioinput', label: 'Microphone' }

export const captureKind = (choice: DeviceChoice): 'audio' | 'video' =>
  choice.kind === 'videoinput' ? 'video' : 'audio'

export async function chooseKind(kind: 'audio' | 'video') {
  const want: DeviceKind = kind === 'video' ? 'videoinput' : 'audioinput'
  const current = useDevice.getState().choice
  if (current.kind === want) return
  const label = kind === 'video' ? 'Camera' : 'Microphone'
  let match: MediaDeviceInfo | undefined
  try {
    const all = await navigator.mediaDevices.enumerateDevices()
    match = all.find((device) => device.kind === want && device.deviceId && device.deviceId !== 'default' && device.deviceId !== 'communications')
  } catch {
    match = undefined
  }
  useDevice.getState().select({
    deviceId: match?.deviceId ?? '',
    kind: want,
    label: match?.label || label,
  })
}

export function readDevice(): DeviceChoice | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeviceChoice>
    if (parsed.kind !== 'audioinput' && parsed.kind !== 'videoinput') return null
    return {
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : '',
      kind: parsed.kind,
      label: typeof parsed.label === 'string' && parsed.label ? parsed.label : parsed.kind === 'videoinput' ? 'Camera' : 'Microphone',
    }
  } catch {
    return null
  }
}

function writeDevice(choice: DeviceChoice) {
  localStorage.setItem(KEY, JSON.stringify(choice))
}

type DeviceState = {
  choice: DeviceChoice
  open: boolean
  select: (choice: DeviceChoice) => void
  setOpen: (open: boolean) => void
}

const saved = readDevice()

export const useDevice = create<DeviceState>((set) => ({
  choice: saved ?? FALLBACK,
  open: saved == null,
  select: (choice) => {
    writeDevice(choice)
    set({ choice, open: false })
  },
  setOpen: (open) => set({ open }),
}))

// No saved choice and no camera at all: default to the microphone instead (not
// persisted — it's still a default). Device kinds are listed before permission.
if (!saved && typeof navigator !== 'undefined' && navigator.mediaDevices?.enumerateDevices) {
  void navigator.mediaDevices.enumerateDevices().then((all) => {
    if (all.some((device) => device.kind === 'videoinput')) return
    if (useDevice.getState().choice === FALLBACK) useDevice.setState({ choice: MIC })
  }).catch(() => undefined)
}
