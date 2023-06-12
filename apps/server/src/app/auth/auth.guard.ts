import {
  CanActivate,
  ExecutionContext,
  Injectable,
  InternalServerErrorException,
  Scope,
  UnauthorizedException,
} from "@nestjs/common";
import { GqlExecutionContext } from "@nestjs/graphql";
import ThirdPartyEmailPassword from "supertokens-node/recipe/thirdpartyemailpassword";
import { UsersService } from "../identity/users.service";
import { RequestUser } from "../identity/users.types";
import Session, { SessionContainer } from "supertokens-node/recipe/session";
import { ProjectsService } from "../identity/projects.service";
import { PinoLogger } from "../logger/pino-logger";

export enum AuthMethod {
  ApiKey = "ApiKey",
  BearerToken = "BearerToken",
}

@Injectable({ scope: Scope.REQUEST })
export class AuthGuard implements CanActivate {
  constructor(
    private readonly usersService: UsersService,
    private readonly projectsService: ProjectsService,
    private readonly logger: PinoLogger
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    return this.authorizeBearerToken(context);
  }

  private async authorizeBearerToken(context: ExecutionContext) {
    const gqlCtx = GqlExecutionContext.create(context);
    const ctx = gqlCtx.getContext();
    const req = ctx.req;
    const res = ctx.res;

    let session: SessionContainer;

    try {
      session = await Session.getSession(req, res, {
        sessionRequired: false,
        antiCsrfCheck: process.env.NODE_ENV === "development" ? false : true,
      });
    } catch (error) {
      throw new UnauthorizedException();
    }

    if (!session) {
      throw new UnauthorizedException();
    }

    const supertokensUser = await ThirdPartyEmailPassword.getUserById(
      session.getUserId()
    );

    req["supertokensUser"] = supertokensUser;

    try {
      const memberships = await this.usersService.getUserOrgMemberships(
        supertokensUser.email
      );

      const reqUser: RequestUser = {
        id: supertokensUser.id,
        email: supertokensUser.email,
        orgMemberships: memberships.map((m) => ({
          organizationId: m.organizationId,
          memberSince: m.createdAt,
          role: m.role,
        })),
      };

      req["user"] = reqUser;
      this.logger.assign({ userId: reqUser.id });
    } catch (error) {
      throw new InternalServerErrorException();
    }

    req.authMethod = AuthMethod.BearerToken;
    return true;
  }
}
