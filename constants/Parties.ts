/**
 * Single source of truth for political parties.
 * Order and list as specified.
 */
export interface Party {
  id: string;
  shortName: string;
  fullName: string;
}

export const PARTIES_DATA: Party[] = [
  { id: 'bjp', shortName: 'BJP', fullName: 'Bharatiya Janata Party' },
  { id: 'inc', shortName: 'INC', fullName: 'Indian National Congress' },
  { id: 'aap', shortName: 'AAP', fullName: 'Aam Aadmi Party' },
  { id: 'bsp', shortName: 'BSP', fullName: 'Bahujan Samaj Party' },
  { id: 'sp', shortName: 'SP', fullName: 'Samajwadi Party' },
  { id: 'sad', shortName: 'SAD', fullName: 'Shiromani Akali Dal' },
  { id: 'aimim', shortName: 'AIMIM', fullName: 'All India Majlis-e-Ittehadul Muslimeen' },
  { id: 'asp', shortName: 'ASP', fullName: 'Azad Samaj Party - Kanshi Ram' },
  { id: 'sad-wpd', shortName: 'SAD-WPD', fullName: 'Shiromani Akali Dal - Waris Punjab De' },
  { id: 'shs-e', shortName: 'SHS-E', fullName: 'Shiv Sena - Eknath Shinde' },
  { id: 'shs-u', shortName: 'SHS-U', fullName: 'Shiv Sena - Uddhav Balasaheb Thackeray' },
  { id: 'ncp-a', shortName: 'NCP-A', fullName: 'Nationalist Congress Party - Ajit Pawar' },
  { id: 'ncp-s', shortName: 'NCP-S', fullName: 'Nationalist Congress Party - Sharadchandra Pawar' },
  { id: 'jdu', shortName: 'JD(U)', fullName: 'Janata Dal - United' },
  { id: 'rjd', shortName: 'RJD', fullName: 'Rashtriya Janata Dal' },
  { id: 'jmm', shortName: 'JMM', fullName: 'Jharkhand Mukti Morcha' },
  { id: 'rld', shortName: 'RLD', fullName: 'Rashtriya Lok Dal' },
  { id: 'ljp', shortName: 'LJP', fullName: 'Lok Janshakti Party - Ram Vilas' },
  { id: 'sbsp', shortName: 'SBSP', fullName: 'Suheldev Bharatiya Samaj Party' },
  { id: 'ad-s', shortName: 'AD(S)', fullName: 'Apna Dal - Sonelal' },
  { id: 'nishad_party', shortName: 'Nishad Party', fullName: 'Nirbal Indian Shoshit Hamara Aam Dal' },
  { id: 'jdl', shortName: 'JDL', fullName: 'Jansatta Dal Loktantrik' },
  { id: 'rlm', shortName: 'RLM', fullName: 'Rashtriya Lok Morcha' },
  { id: 'ham', shortName: 'HAM', fullName: 'Hindustani Awam Morcha - Secular' },
  { id: 'vip', shortName: 'VIP', fullName: 'Vikassheel Insaan Party' },
  { id: 'mns', shortName: 'MNS', fullName: 'Maharashtra Navnirman Sena' },
  { id: 'vba', shortName: 'VBA', fullName: 'Vanchit Bahujan Aghadi' },
  { id: 'rlp', shortName: 'RLP', fullName: 'Rashtriya Loktantrik Party' },
  { id: 'bap', shortName: 'BAP', fullName: 'Bharat Adivasi Party' },
  { id: 'inld', shortName: 'INLD', fullName: 'Indian National Lok Dal' },
  { id: 'jjp', shortName: 'JJP', fullName: 'Jannayak Janta Party' },
  { id: 'ajsu', shortName: 'AJSU', fullName: 'All Jharkhand Students Union' },
];

export const PARTIES_FIRST_8 = PARTIES_DATA.slice(0, 8);
export const PARTIES_MORE = PARTIES_DATA.slice(8);
