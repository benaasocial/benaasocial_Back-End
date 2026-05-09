import { Request } from "express";
import { IUserPayload } from "./user";


export interface AuthenticatedRequest extends Request {
    requestId?: string;
    user?: IUserPayload;
};