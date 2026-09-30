import { Router } from "express";
import { optionalUser, requireUser } from "../auth.js";
import { AdminController } from "../controllers/admin.controller.js";
import { EngagementController } from "../controllers/engagement.controller.js";
import { CatalogController, PropertyController, UserController } from "../controllers/property.controller.js";
import { AuthController } from "../controllers/auth.controller.js";
import { PaymentController } from "../controllers/payment.controller.js";
import { WalletController } from "../controllers/wallet.controller.js";
import { uploadRouter } from "./uploads.js";

export const apiRouter = Router();

apiRouter.get("/health", CatalogController.health);
apiRouter.post("/auth/signup", AuthController.signup);
apiRouter.post("/auth/login", AuthController.login);
apiRouter.post("/auth/google", AuthController.google);
apiRouter.use("/uploads", uploadRouter);
apiRouter.get("/categories", optionalUser, CatalogController.categories);
apiRouter.get("/amenities", optionalUser, CatalogController.amenities);
apiRouter.get("/plans", optionalUser, CatalogController.plans);

apiRouter.get("/properties", optionalUser, PropertyController.list);
apiRouter.get("/properties/:id", optionalUser, PropertyController.show);
apiRouter.post("/properties", requireUser, PropertyController.create);
apiRouter.patch("/properties/:id", requireUser, PropertyController.update);
apiRouter.delete("/properties/:id", requireUser, PropertyController.remove);
apiRouter.post("/properties/:id/view", optionalUser, PropertyController.view);

apiRouter.post("/payments/order", requireUser, PaymentController.order);
apiRouter.post("/payments/verify", requireUser, PaymentController.verify);
apiRouter.get("/wallet", requireUser, WalletController.show);
apiRouter.post("/wallet/order", requireUser, WalletController.order);
apiRouter.post("/wallet/verify", requireUser, WalletController.verify);
apiRouter.post("/wallet/spend", requireUser, WalletController.spend);

apiRouter.get("/me", requireUser, UserController.me);
apiRouter.patch("/me", requireUser, UserController.update);

apiRouter.post("/properties/:id/favorite", requireUser, EngagementController.favorite);
apiRouter.delete("/properties/:id/favorite", requireUser, EngagementController.unfavorite);
apiRouter.get("/favorites", requireUser, EngagementController.favorites);
apiRouter.post("/properties/:id/inquiries", requireUser, EngagementController.createInquiry);
apiRouter.get("/inquiries", requireUser, EngagementController.inquiries);
apiRouter.patch("/inquiries/:id", requireUser, EngagementController.updateInquiry);
apiRouter.post("/properties/:id/visits", requireUser, EngagementController.createVisit);
apiRouter.get("/visits", requireUser, EngagementController.visits);
apiRouter.patch("/visits/:id", requireUser, EngagementController.updateVisit);
apiRouter.post("/properties/:id/reports", requireUser, EngagementController.createReport);
apiRouter.get("/saved-searches", requireUser, EngagementController.savedSearches);
apiRouter.post("/saved-searches", requireUser, EngagementController.createSavedSearch);
apiRouter.delete("/saved-searches/:id", requireUser, EngagementController.deleteSavedSearch);
apiRouter.get("/notifications", requireUser, EngagementController.notifications);
apiRouter.patch("/notifications/:id/read", requireUser, EngagementController.readNotification);
apiRouter.post("/properties/:id/images", requireUser, EngagementController.addImage);
apiRouter.delete("/properties/:id/images/:imageId", requireUser, EngagementController.removeImage);

apiRouter.get("/admin/stats", requireUser, AdminController.stats);
apiRouter.get("/admin/properties", requireUser, AdminController.properties);
apiRouter.patch("/admin/properties/:id", requireUser, AdminController.updateProperty);
apiRouter.get("/admin/reports", requireUser, AdminController.reports);
apiRouter.patch("/admin/reports/:id", requireUser, AdminController.updateReport);
apiRouter.patch("/admin/documents/:id", requireUser, AdminController.updateDocument);
