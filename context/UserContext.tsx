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
  state: string;
  district: string;
  assembly: string;
  whatsapp: string;
  facebook: string;
  twitter: string;
  instagram: string;
}

interface UserContextType {
  userInfo: UserInfo;
  setUserInfo: React.Dispatch<React.SetStateAction<UserInfo>>;
}

const UserContext = createContext<UserContextType | undefined>(undefined);

export const UserProvider = ({ children }: { children: ReactNode }) => {
  const [userInfo, setUserInfo] = useState<UserInfo>({
    name: "Mohit Bhai",
    phone: "9540477457",
    email: "mohit@example.com",
    designation: "Social Media Warrior",
    designation2: "",
    designation3: "",
    designation4: "",
    profilePics: ["https://i.pravatar.cc/150?u=mohit"], // Default array
    activePhotoIndex: 0,
    partyName: "bjp",
    state: "Uttar Pradesh",
    district: "Meerut",
    assembly: "Meerut Cantt",
    whatsapp: "9540477457",
    facebook: "",
    twitter: "",
    instagram: ""
  });

  return (
    <UserContext.Provider value={{ userInfo, setUserInfo }}>
      {children}
    </UserContext.Provider>
  );
};

export const useUser = () => {
  const context = useContext(UserContext);
  if (context === undefined) throw new Error('useUser must be used within a UserProvider');
  return context;
};