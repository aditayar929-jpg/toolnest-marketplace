require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const Database = require("better-sqlite3");
const multer = require("multer");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
const UPLOADS = path.join(ROOT, "uploads");
fs.mkdirSync(DATA, {recursive:true});
fs.mkdirSync(UPLOADS, {recursive:true});

app.use(helmet({crossOriginResourcePolicy:{policy:"cross-origin"}, contentSecurityPolicy:false}));
app.use(express.json({limit:"1mb"}));
app.use(express.urlencoded({extended:false}));
app.use("/api", rateLimit({windowMs:15*60*1000, max:250, standardHeaders:true, legacyHeaders:false}));
app.use(express.static(path.join(ROOT,"public")));

const db = new Database(path.join(DATA,"marketplace.sqlite"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS admins(id INTEGER PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS products(
 id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 category TEXT NOT NULL DEFAULT 'Tool', kind TEXT NOT NULL DEFAULT 'tool',
 price INTEGER NOT NULL DEFAULT 0, currency TEXT NOT NULL DEFAULT 'INR',
 file_name TEXT, file_label TEXT, tool_key TEXT, featured INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS orders(
 id TEXT PRIMARY KEY, email TEXT NOT NULL, product_id INTEGER NOT NULL,
 amount INTEGER NOT NULL, currency TEXT NOT NULL, provider TEXT NOT NULL,
 provider_order_id TEXT, payment_id TEXT, status TEXT NOT NULL DEFAULT 'pending',
 access_token TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(product_id) REFERENCES products(id)
);
`);
const adminEmail = (process.env.ADMIN_EMAIL || "admin@example.com").toLowerCase();
const adminPassword = process.env.ADMIN_PASSWORD || "ChangeThisAdminPassword123!";
if (!db.prepare("SELECT id FROM admins WHERE email=?").get(adminEmail)) {
  db.prepare("INSERT INTO admins(email,password_hash) VALUES(?,?)").run(adminEmail,bcrypt.hashSync(adminPassword,12));
}
if (db.prepare("SELECT COUNT(*) n FROM products").get().n === 0) {
  const add = db.prepare("INSERT INTO products(title,description,category,kind,price,currency,tool_key,featured) VALUES(?,?,?,?,?,?,?,?)");
  add.run("Image Compressor","Compress JPG, PNG and WebP images in your browser. Files stay on your device.","Image","tool",0,"INR","image-compressor",1);
  add.run("Text Utilities","Convert case, remove extra spaces and count words instantly.","Productivity","tool",0,"INR","text-tools",1);
  add.run("Sample APK Listing","Replace this demo listing with your own legally distributable Android APK.","Android Apps","apk",9900,"INR",null,0);
}
const sign = (payload) => jwt.sign(payload, process.env.JWT_SECRET || "development-only-change-me", {expiresIn:"12h"});
function auth(req,res,next){
  const token=(req.headers.authorization||"").replace(/^Bearer\s+/i,"");
  try { req.user=jwt.verify(token,process.env.JWT_SECRET||"development-only-change-me"); next(); }
  catch { return res.status(401).json({error:"Please login again."}); }
}
function adminOnly(req,res,next){ if(req.user?.role!=="admin") return res.status(403).json({error:"Admin access required."}); next(); }
const upload = multer({
  storage:multer.diskStorage({
    destination:(req,file,cb)=>cb(null,UPLOADS),
    filename:(req,file,cb)=>cb(null,crypto.randomUUID()+path.extname(file.originalname).toLowerCase())
  }),
  limits:{fileSize:150*1024*1024},
  fileFilter:(req,file,cb)=>{
    const ext=path.extname(file.originalname).toLowerCase();
    if(ext!==".apk") return cb(new Error("Only .apk files are accepted."));
    cb(null,true);
  }
});
const publicProduct = p => ({id:p.id,title:p.title,description:p.description,category:p.category,kind:p.kind,price:p.price,currency:p.currency,featured:!!p.featured,toolKey:p.tool_key});
app.get("/api/products",(req,res)=>{
  const rows=db.prepare("SELECT * FROM products WHERE active=1 ORDER BY featured DESC,id DESC").all();
  res.json(rows.map(publicProduct));
});
app.post("/api/admin/login", async (req,res)=>{
  const email=String(req.body.email||"").toLowerCase().trim(), password=String(req.body.password||"");
  const a=db.prepare("SELECT * FROM admins WHERE email=?").get(email);
  if(!a || !await bcrypt.compare(password,a.password_hash)) return res.status(401).json({error:"Invalid email or password."});
  res.json({token:sign({id:a.id,email:a.email,role:"admin"}),email:a.email});
});
app.get("/api/admin/products",auth,adminOnly,(req,res)=>res.json(db.prepare("SELECT * FROM products ORDER BY id DESC").all()));
app.post("/api/admin/products",auth,adminOnly,upload.single("apk"),(req,res)=>{
  const b=req.body;
  const title=String(b.title||"").trim(), description=String(b.description||"").trim();
  const kind=b.kind==="apk"?"apk":"tool", price=Math.max(0,Math.round(Number(b.price||0)));
  if(!title) return res.status(400).json({error:"Product title is required."});
  if(kind==="apk" && !req.file) return res.status(400).json({error:"Upload an APK file."});
  if(kind==="tool" && !["image-compressor","text-tools"].includes(b.tool_key)) return res.status(400).json({error:"Choose a supported tool key."});
  const info=db.prepare(`INSERT INTO products(title,description,category,kind,price,currency,file_name,file_label,tool_key,featured,active)
    VALUES(?,?,?,?,?,'INR',?,?,?,?,1)`).run(title,description,String(b.category||"General"),kind,price,
      req.file?.filename||null,req.file?.originalname||null,kind==="tool"?b.tool_key:null,b.featured==="true"?1:0);
  res.json({ok:true,id:info.lastInsertRowid});
});
app.patch("/api/admin/products/:id",auth,adminOnly,(req,res)=>{
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if(!p) return res.status(404).json({error:"Product not found."});
  const active=req.body.active===false?0:1;
  db.prepare("UPDATE products SET active=? WHERE id=?").run(active,p.id);
  res.json({ok:true});
});
app.delete("/api/admin/products/:id",auth,adminOnly,(req,res)=>{
  const p=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  if(!p) return res.status(404).json({error:"Product not found."});
  db.prepare("UPDATE products SET active=0 WHERE id=?").run(p.id);
  res.json({ok:true});
});
app.get("/api/admin/orders",auth,adminOnly,(req,res)=>{
  res.json(db.prepare(`SELECT o.*,p.title FROM orders o JOIN products p ON p.id=o.product_id ORDER BY o.created_at DESC LIMIT 300`).all());
});

function createOrder(product,email,provider,providerOrderId){
  const id=crypto.randomUUID(), access=crypto.randomBytes(32).toString("hex");
  db.prepare(`INSERT INTO orders(id,email,product_id,amount,currency,provider,provider_order_id,access_token,status)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(id,email,product.id,product.price,product.currency,provider,providerOrderId||null,access,product.price===0?"paid":"pending");
  return db.prepare("SELECT * FROM orders WHERE id=?").get(id);
}
app.post("/api/checkout/free",(req,res)=>{
  const product=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(Number(req.body.productId));
  const email=String(req.body.email||"").trim().toLowerCase();
  if(!product || product.price!==0) return res.status(400).json({error:"This item is not free."});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email."});
  const order=createOrder(product,email,"free");
  res.json({ok:true,downloadUrl:`/download/${order.access_token}`});
});
app.post("/api/checkout/razorpay",async (req,res)=>{
  try{
    if(!process.env.RAZORPAY_KEY_ID||!process.env.RAZORPAY_KEY_SECRET) return res.status(503).json({error:"Razorpay keys are not configured."});
    const product=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(Number(req.body.productId));
    const email=String(req.body.email||"").trim().toLowerCase();
    if(!product||product.price<=0) return res.status(400).json({error:"Invalid paid product."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email."});
    const order=createOrder(product,email,"razorpay");
    const authHeader="Basic "+Buffer.from(process.env.RAZORPAY_KEY_ID+":"+process.env.RAZORPAY_KEY_SECRET).toString("base64");
    const response=await fetch("https://api.razorpay.com/v1/orders",{method:"POST",headers:{"Authorization":authHeader,"Content-Type":"application/json"},
      body:JSON.stringify({amount:product.price,currency:"INR",receipt:order.id,notes:{local_order_id:order.id}})});
    const data=await response.json();
    if(!response.ok) throw new Error(data.error?.description||"Razorpay order creation failed.");
    db.prepare("UPDATE orders SET provider_order_id=? WHERE id=?").run(data.id,order.id);
    res.json({keyId:process.env.RAZORPAY_KEY_ID,razorpayOrderId:data.id,amount:data.amount,currency:data.currency,localOrderId:order.id});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/checkout/razorpay/verify",(req,res)=>{
  const {razorpay_order_id,razorpay_payment_id,razorpay_signature,localOrderId}=req.body;
  const order=db.prepare("SELECT * FROM orders WHERE id=? AND provider='razorpay'").get(localOrderId);
  if(!order||order.provider_order_id!==razorpay_order_id) return res.status(400).json({error:"Order not found."});
  const expected=crypto.createHmac("sha256",process.env.RAZORPAY_KEY_SECRET||"").update(razorpay_order_id+"|"+razorpay_payment_id).digest("hex");
  if(!crypto.timingSafeEqual(Buffer.from(expected),Buffer.from(String(razorpay_signature||"")))) return res.status(400).json({error:"Payment signature verification failed."});
  db.prepare("UPDATE orders SET status='paid',payment_id=? WHERE id=?").run(razorpay_payment_id,order.id);
  res.json({ok:true,downloadUrl:`/download/${order.access_token}`});
});
async function paypalToken(){
  const base=process.env.PAYPAL_MODE==="live"?"https://api-m.paypal.com":"https://api-m.sandbox.paypal.com";
  const r=await fetch(base+"/v1/oauth2/token",{method:"POST",headers:{Authorization:"Basic "+Buffer.from(process.env.PAYPAL_CLIENT_ID+":"+process.env.PAYPAL_CLIENT_SECRET).toString("base64"),"Content-Type":"application/x-www-form-urlencoded"},body:"grant_type=client_credentials"});
  const d=await r.json(); if(!r.ok) throw new Error(d.error_description||"PayPal authentication failed."); return {token:d.access_token,base};
}
app.post("/api/checkout/paypal",async(req,res)=>{
  try{
    if(!process.env.PAYPAL_CLIENT_ID||!process.env.PAYPAL_CLIENT_SECRET) return res.status(503).json({error:"PayPal keys are not configured."});
    const product=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(Number(req.body.productId));
    const email=String(req.body.email||"").trim().toLowerCase();
    if(!product||product.price<=0) return res.status(400).json({error:"Invalid paid product."});
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({error:"Enter a valid email."});
    const local=createOrder(product,email,"paypal");
    const {token,base}=await paypalToken();
    const amount=(product.price/100).toFixed(2);
    const r=await fetch(base+"/v2/checkout/orders",{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({intent:"CAPTURE",purchase_units:[{reference_id:local.id,amount:{currency_code:"USD",value:amount}}],application_context:{return_url:process.env.BASE_URL+"/?paypal=success&order="+local.id,cancel_url:process.env.BASE_URL+"/?paypal=cancel"}})});
    const data=await r.json(); if(!r.ok) throw new Error(data.message||"PayPal order creation failed.");
    db.prepare("UPDATE orders SET provider_order_id=? WHERE id=?").run(data.id,local.id);
    res.json({paypalOrderId:data.id,localOrderId:local.id,approveUrl:data.links.find(x=>x.rel==="approve")?.href});
  }catch(e){res.status(500).json({error:e.message});}
});
app.post("/api/checkout/paypal/capture",async(req,res)=>{
  try{
    const order=db.prepare("SELECT * FROM orders WHERE id=? AND provider='paypal'").get(req.body.localOrderId);
    if(!order||order.provider_order_id!==req.body.paypalOrderId) return res.status(400).json({error:"Order not found."});
    const {token,base}=await paypalToken();
    const r=await fetch(base+`/v2/checkout/orders/${encodeURIComponent(order.provider_order_id)}/capture`,{method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"}});
    const data=await r.json();
    if(!r.ok||data.status!=="COMPLETED") return res.status(400).json({error:data.message||"PayPal capture was not completed."});
    db.prepare("UPDATE orders SET status='paid',payment_id=? WHERE id=?").run(data.id,order.id);
    res.json({ok:true,downloadUrl:`/download/${order.access_token}`});
  }catch(e){res.status(500).json({error:e.message});}
});
app.get("/download/:token",(req,res)=>{
  const order=db.prepare(`SELECT o.*,p.file_name,p.file_label,p.kind,p.title FROM orders o JOIN products p ON p.id=o.product_id WHERE o.access_token=? AND o.status='paid'`).get(req.params.token);
  if(!order) return res.status(404).send("Download link invalid or payment not confirmed.");
  if(order.kind!=="apk"||!order.file_name) return res.redirect("/?purchased=1");
  const file=path.join(UPLOADS,path.basename(order.file_name));
  if(!fs.existsSync(file)) return res.status(404).send("File is no longer available.");
  res.download(file,order.file_label||order.title+".apk");
});
app.get("/api/health",(req,res)=>res.json({ok:true,service:"Digital Marketplace"}));
app.get("*",(req,res)=>res.sendFile(path.join(ROOT,"public","index.html")));
app.use((err,req,res,next)=>{console.error(err);res.status(400).json({error:err.message||"Request failed."});});
app.listen(PORT,()=>console.log(`Marketplace running at http://localhost:${PORT}`));
