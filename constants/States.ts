/**
 * 14 states - synced with socialbot lib/constants.ts
 * Supabase state column stores exact name.
 */
export interface StateItem {
  id: string;
  name: string;
}

export const STATES_DATA: StateItem[] = [
  { id: 'bihar', name: 'Bihar' },
  { id: 'chhattisgarh', name: 'Chhattisgarh' },
  { id: 'delhi', name: 'Delhi' },
  { id: 'gujarat', name: 'Gujarat' },
  { id: 'haryana', name: 'Haryana' },
  { id: 'himachal_pradesh', name: 'Himachal Pradesh' },
  { id: 'jammu_kashmir', name: 'Jammu and Kashmir' },
  { id: 'jharkhand', name: 'Jharkhand' },
  { id: 'madhya_pradesh', name: 'Madhya Pradesh' },
  { id: 'maharashtra', name: 'Maharashtra' },
  { id: 'punjab', name: 'Punjab' },
  { id: 'rajasthan', name: 'Rajasthan' },
  { id: 'uttar_pradesh', name: 'Uttar Pradesh' },
  { id: 'uttarakhand', name: 'Uttarakhand' },
];
