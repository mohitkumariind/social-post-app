import React, { createContext, ReactNode, useContext, useState } from 'react';

interface UserInfo {
  name: string;
  phone: string;
  email: string;
  designation: string; 
  designation2: string;
  designation3: string;
  designation4: string;
  profilePics: string[]; // Correct: Array of strings
  activePhotoIndex: number;
  partyName: string;
  state_id: number | null;
  loksabha_id: number | null;
  assembly_id: number | null;
  whatsapp: string;
  facebook: string;
  twitter: string;
  instagram: string;
}

interface UserContextType {
  userInfo: UserInfo;
  setUserInfo: React.Dispatch<React.SetStateAction<UserInfo>>;
  isLoggedIn: boolean;
  setIsLoggedIn: React.Dispatch<React.SetStateAction<boolean>>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [userInfo, setUserInfo] = useState<UserInfo>({
    name: '',
    phone: '',
    email: '',
    designation: '',
    designation2: '',
    designation3: '',
    designation4: '',
    profilePics: [],
    activePhotoIndex: 0,
    partyName: '',
    state_id: null,
    loksabha_id: null,
    assembly_id: null,
    whatsapp: '',
    facebook: '',
    twitter: '',
    instagram: '',
  });

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