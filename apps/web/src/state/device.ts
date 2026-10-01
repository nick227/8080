import { create } from 'zustand'

const KEY = '8080.device'

export type DeviceKind = 'audioinput' | 'videoinput'

export type DeviceChoice = {
  deviceId: string
  kind: DeviceKind
  label: string
}

const FALLBACK: DeviceChoice = { deviceId: '', kind: 'audioinput', label: 'Microphone' }

export const captureKind = (choice: DeviceChoice): 'audio' | 'video' =>
  choice.kind === 'videoinput' ? 'video' : 'audio'

export function readDevice(): DeviceChoice | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<DeviceChoice>
    if (parsed.kind !== 'audioinput' && parsed.kind !== 'videoinput') return null
    return {
      deviceId: typeof parsed.deviceId === 'string' ? parsed.deviceId : '',
      kind: parsed.kind,
      label: typeof parsed.label === 'string' && parsed.label ? parsed.label : FALLBACK.label,
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
