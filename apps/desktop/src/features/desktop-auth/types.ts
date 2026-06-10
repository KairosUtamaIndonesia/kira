type SigninStatus = {
  signedIn: boolean;
  userName: string | null;
  userEmail: string | null;
  organizationId: string | null;
  organizationName: string | null;
};

type SigninComplete = {
  userName: string;
  userEmail: string;
  organizationId: string;
  organizationName: string;
};

export type { SigninComplete, SigninStatus };
