import React, { createContext, ReactNode, useContext, useState } from 'react';

export interface UserInfo {
  /** Selected app language (mirrors `profiles.language`, and LanguageContext). */
  language: string;
  name: string;
  phone: string;
  email: string;
  designation1: string;
  designation2: string;
  designation3: string;
  designation4: string;
  avatar_url: string;
  /** Maps to `profiles.party` */
  partyName: string;
  /** Maps to `profiles.state` (e.g. state name) — not `state_id` */
  state: string;
  loksabha_id: number | null;
  /** Human-readable Lok Sabha name (for poster labels). Maps to `profiles.loksabha` */
  loksabha: string;
  assembly_id: number | null;
  /** Human-readable Assembly name (for poster labels). Maps to `profiles.assembly` */
  assembly: string;
  whatsapp: string;
  facebook: string;
  twitter: string;
  instagram: string;
  /** Direct mapping tags: `profiles.group_tags` */
  group_tags: string[];
}

export const EMPTY_USER_INFO: UserInfo = {
  language: '',
  name: '',
  phone: '',
  email: '',
  designation1: '',
  designation2: '',
  designation3: '',
  designation4: '',
  avatar_url: '',
  partyName: '',
  state: '',
  loksabha_id: null,
  assembly_id: null,
  loksabha: '',
  assembly: '',
  whatsapp: '',
  facebook: '',
  twitter: '',
  instagram: '',
  group_tags: [],
};

interface UserContextType {
  userInfo: UserInfo;
  setUserInfo: React.Dispatch<React.SetStateAction<UserInfo>>;
  isLoggedIn: boolean;
  setIsLoggedIn: React.Dispatch<React.SetStateAction<boolean>>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo>({ ...EMPTY_USER_INFO });

  return (
    <UserContext.Provider value={{ userInfo, setUserInfo, isLoggedIn, setIsLoggedIn }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) throw new Error('useUser must be used within a UserProvider');
  return context;
};
