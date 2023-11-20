import { User } from "../User";

export interface UserTag {
  name: string;
  category: string;
}

export interface SqlUser extends User {
  id: string;
  // TODO - remove this field from SQL
  tags?: string;
  created_at: string;
  updated_at: string;
}
