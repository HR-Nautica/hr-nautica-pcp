import { Router } from "express";
import { addBomLine, addRoutingStep, CatalogError, createProduct, deactivateProduct, deleteBomLine, deleteRoutingStep, deleteStep, deleteSupplier, getProduct, listProducts, listSteps, listStock, listSuppliers, saveStep, saveSupplier, updateProduct } from "../product-catalog.js";

const router=Router();
import {setProductStatus} from '../product-catalog.js';
import { getHeliceAnalysis, saveCoverageParameters } from '../helice-analysis.js';
const actor=req=>String(req.auth?.username||"").slice(0,100);
const admin=(req,res,next)=>req.auth?.role==="admin"?next():res.status(403).json({ok:false,error:"Permissão de administrador obrigatória."});
const reply=(error,res,next)=>error instanceof CatalogError?res.status(error.status).json({ok:false,code:error.code,error:error.message}):next(error);

router.use(admin);
router.get('/analysis/helices',async(_req,res,next)=>{try{res.json({ok:true,...await getHeliceAnalysis()});}catch(error){reply(error,res,next);}});
router.put('/analysis/helices/parameters',async(req,res,next)=>{try{res.json({ok:true,...await saveCoverageParameters(req.body,actor(req))});}catch(error){reply(error,res,next);}});
router.get("/products",async(req,res,next)=>{try{res.json({ok:true,...await listProducts(req.query)});}catch(e){reply(e,res,next);}});
router.post("/products",async(req,res,next)=>{try{res.status(201).json({ok:true,product:await createProduct(req.body,actor(req))});}catch(e){reply(e,res,next);}});
router.get("/products/:id",async(req,res,next)=>{try{res.json({ok:true,...await getProduct(req.params.id)});}catch(e){reply(e,res,next);}});
router.put("/products/:id",async(req,res,next)=>{try{res.json({ok:true,product:await updateProduct(req.params.id,req.body,actor(req))});}catch(e){reply(e,res,next);}});
router.patch('/products/:id/status',async(req,res,next)=>{try{res.json({ok:true,product:await setProductStatus(req.params.id,req.body?.status,req.body?.version,actor(req))});}catch(e){reply(e,res,next);}});
router.delete("/products/:id",async(req,res,next)=>{try{res.json({ok:true,product:await deactivateProduct(req.params.id,req.body?.version,actor(req))});}catch(e){reply(e,res,next);}});
router.post("/products/:id/bom",async(req,res,next)=>{try{res.status(201).json({ok:true,item:await addBomLine(req.params.id,req.body,actor(req))});}catch(e){reply(e,res,next);}});
router.delete("/products/:id/bom/:lineId",async(req,res,next)=>{try{res.json({ok:true,item:await deleteBomLine(req.params.id,req.params.lineId)});}catch(e){reply(e,res,next);}});
router.post("/products/:id/routing",async(req,res,next)=>{try{res.status(201).json({ok:true,item:await addRoutingStep(req.params.id,req.body,actor(req))});}catch(e){reply(e,res,next);}});
router.delete("/products/:id/routing/:routingId",async(req,res,next)=>{try{res.json({ok:true,item:await deleteRoutingStep(req.params.id,req.params.routingId,req.body?.version)});}catch(e){reply(e,res,next);}});
router.get("/suppliers",async(_req,res,next)=>{try{res.json({ok:true,items:await listSuppliers()});}catch(e){reply(e,res,next);}});
router.post("/suppliers",async(req,res,next)=>{try{res.status(201).json({ok:true,item:await saveSupplier(req.body,actor(req))});}catch(e){reply(e,res,next);}});
router.put("/suppliers/:id",async(req,res,next)=>{try{res.json({ok:true,item:await saveSupplier(req.body,actor(req),req.params.id)});}catch(e){reply(e,res,next);}});
router.delete("/suppliers/:id",async(req,res,next)=>{try{res.json({ok:true,item:await deleteSupplier(req.params.id)});}catch(e){reply(e,res,next);}});
router.get("/steps",async(_req,res,next)=>{try{res.json({ok:true,items:await listSteps()});}catch(e){reply(e,res,next);}});
router.post("/steps",async(req,res,next)=>{try{res.status(201).json({ok:true,item:await saveStep(req.body,actor(req))});}catch(e){reply(e,res,next);}});
router.put("/steps/:id",async(req,res,next)=>{try{res.json({ok:true,item:await saveStep(req.body,actor(req),req.params.id)});}catch(e){reply(e,res,next);}});
router.delete("/steps/:id",async(req,res,next)=>{try{res.json({ok:true,item:await deleteStep(req.params.id)});}catch(e){reply(e,res,next);}});
router.get("/stock",async(req,res,next)=>{try{res.json({ok:true,items:await listStock(req.query)});}catch(e){reply(e,res,next);}});

export default router;
import { syncTinyStock, getLastTinyStockUpdate } from '../tiny-stock-sync.js';
router.get('/stock/last-update',async(_req,res,next)=>{try{res.json({ok:true,lastUpdate:await getLastTinyStockUpdate()});}catch(error){reply(error,res,next);}});
for(const preview of [true,false])router.post(preview?'/stock/preview':'/stock/sync',async(req,res,next)=>{try{
 const encoded=String(req.body?.fileBase64||'');
 if(!encoded||encoded.length>20000000||!/^[A-Za-z0-9+/=]+$/.test(encoded))throw new CatalogError('Arquivo inválido ou maior que o limite permitido.');
 if(!preview&&!/^[0-9a-f]{64}$/.test(String(req.body?.expectedPlan||'')))throw new CatalogError('Analise a planilha antes de confirmar.');
 res.json({ok:true,...await syncTinyStock(Buffer.from(encoded,'base64'),{actor:actor(req),fileName:req.body?.fileName,requestId:req.body?.requestId,preview,expectedPlan:req.body?.expectedPlan,scope:req.body?.scope??'all'})});
}catch(error){reply(error,res,next);}});
