# Deploying PedX Visualizer to Vercel

This guide will walk you through deploying the PedX Visualizer to Vercel.

## Prerequisites

1. **GitHub Account**: Your code should be pushed to a GitHub repository
2. **Vercel Account**: Sign up at [vercel.com](https://vercel.com) (free tier available)
3. **PostgreSQL Database**: You'll need a hosted PostgreSQL database (see options below)
4. **Cesium Ion Token**: Get a free token from [ion.cesium.com](https://ion.cesium.com)

## Step 1: Set Up Hosted PostgreSQL Database

Vercel doesn't host databases, so you'll need a separate PostgreSQL service. Here are recommended options:

### Option A: Neon (Recommended - Free Tier Available)
1. Go to [neon.tech](https://neon.tech)
2. Sign up for a free account
3. Create a new project
4. Copy the connection string (it will look like: `postgresql://user:password@host/database?sslmode=require`)

### Option B: Supabase (Free Tier Available)
1. Go to [supabase.com](https://supabase.com)
2. Create a new project
3. Go to Settings → Database
4. Copy the connection string

### Option C: Railway (Free Tier Available)
1. Go to [railway.app](https://railway.app)
2. Create a new project
3. Add a PostgreSQL service
4. Copy the connection string from the Variables tab

### Option D: Render (Free Tier Available)
1. Go to [render.com](https://render.com)
2. Create a new PostgreSQL database
3. Copy the connection string from the database dashboard

**After setting up your database:**
1. Run the database setup script locally to initialize the schema:
   ```bash
   # Update your local .env.local with the new DATABASE_URL
   DATABASE_URL=your_postgresql_connection_string
   
   # Run setup
   npm run setup-db
   
   # Aggregate your CSV data
   npm run aggregate-csv
   ```

## Step 2: Get Cesium Ion Token

1. Visit [https://ion.cesium.com/](https://ion.cesium.com/)
2. Sign up for a free account
3. Create a new access token
4. Copy the token (you'll need it for environment variables)

## Step 3: Deploy to Vercel

### Method A: Using Vercel Dashboard (Recommended)

1. **Connect Your Repository**
   - Go to [vercel.com/dashboard](https://vercel.com/dashboard)
   - Click "Add New..." → "Project"
   - Import your GitHub repository
   - Select the repository containing your PedX Visualizer code

2. **Configure Project Settings**
   - **Framework Preset**: Next.js (should auto-detect)
   - **Root Directory**: `./` (default)
   - **Build Command**: `npm run build` (default)
   - **Output Directory**: `.next` (default)
   - **Install Command**: `npm install` (default)

3. **Set Environment Variables**
   Click "Environment Variables" and add the following:

   ```
   DATABASE_URL=postgresql://user:password@host/database?sslmode=require
   NEXT_PUBLIC_CESIUM_ION_TOKEN=your_cesium_ion_token_here
   NODE_ENV=production
   ```

   **Optional Environment Variables:**
   ```
   GEONAMES_USERNAME=your_geonames_username (if using GeoNames API)
   ```

4. **Deploy**
   - Click "Deploy"
   - Wait for the build to complete (usually 2-5 minutes)
   - Your app will be live at `https://your-project.vercel.app`

### Method B: Using Vercel CLI

1. **Install Vercel CLI**
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**
   ```bash
   vercel login
   ```

3. **Deploy**
   ```bash
   # From your project directory
   vercel
   
   # Follow the prompts:
   # - Link to existing project? No (first time) or Yes (updates)
   # - Project name: pedx-visualizer (or your preferred name)
   # - Directory: ./
   ```

4. **Set Environment Variables**
   ```bash
   vercel env add DATABASE_URL
   # Paste your PostgreSQL connection string when prompted
   
   vercel env add NEXT_PUBLIC_CESIUM_ION_TOKEN
   # Paste your Cesium Ion token when prompted
   
   vercel env add NODE_ENV production
   ```

5. **Deploy to Production**
   ```bash
   vercel --prod
   ```

## Step 4: Verify Deployment

1. **Check Build Logs**
   - Go to your Vercel dashboard
   - Click on your project
   - Check the "Deployments" tab for build logs
   - Ensure the build completed successfully

2. **Test Your Application**
   - Visit your deployed URL
   - Verify the globe loads correctly
   - Test city selection and filtering
   - Check API endpoints are working

3. **Common Issues to Check**
   - **Cesium not loading**: Verify `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set correctly
   - **Database errors**: Check `DATABASE_URL` is correct and database is accessible
   - **Build failures**: Check build logs for specific errors

## Step 5: Configure Custom Domain (Optional)

1. Go to your project settings in Vercel
2. Click "Domains"
3. Add your custom domain
4. Follow DNS configuration instructions

## Environment Variables Reference

### Required Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://user:pass@host/db?sslmode=require` |
| `NEXT_PUBLIC_CESIUM_ION_TOKEN` | Cesium Ion access token | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| `NODE_ENV` | Environment mode | `production` |

### Optional Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `GEONAMES_USERNAME` | GeoNames API username | `your_username` |

## Build Configuration

Vercel will automatically:
- Detect Next.js framework
- Run `npm install` (which triggers the postinstall script to copy Cesium assets)
- Run `npm run build`
- Serve the application

The `next.config.mjs` file is already configured for:
- Cesium webpack configuration
- Static asset serving
- Worker file copying

## Database Considerations

### Initial Setup
Run these commands locally before deploying (or use a database migration tool):

```bash
# Set your production DATABASE_URL locally
export DATABASE_URL=your_production_database_url

# Setup schema
npm run setup-db

# Aggregate CSV data
npm run aggregate-csv
```

### Ongoing Updates
For database updates, you can:
1. Run scripts locally against production database
2. Use a database migration tool
3. Set up a CI/CD pipeline to run migrations

### Database Connection Security
- Always use SSL connections in production (`?sslmode=require`)
- Never commit database credentials to git
- Use environment variables for all sensitive data
- Consider using connection pooling for better performance

## Performance Optimization

### Vercel Optimizations
- **Edge Functions**: Consider moving API routes to Edge Functions for better performance
- **Caching**: Configure appropriate cache headers for static assets
- **Image Optimization**: Vercel automatically optimizes Next.js images

### Database Optimizations
- Ensure proper indexes are created (check `database/schema.sql`)
- Use connection pooling (already configured in `src/lib/database.ts`)
- Consider read replicas for high traffic

## Monitoring & Debugging

### Vercel Analytics
1. Enable Vercel Analytics in project settings
2. Monitor performance metrics
3. Track errors and issues

### Logs
- View real-time logs in Vercel dashboard
- Use `vercel logs` command for CLI access
- Check function logs for API route debugging

### Database Monitoring
- Use your database provider's monitoring tools
- Set up alerts for connection issues
- Monitor query performance

## Continuous Deployment

Vercel automatically deploys when you push to your main branch:
1. Push changes to GitHub
2. Vercel detects the push
3. Builds and deploys automatically
4. Sends deployment notifications

### Branch Previews
- Every branch gets a preview deployment
- Perfect for testing before merging
- Share preview URLs with team members

## Troubleshooting

### Build Fails
- Check build logs in Vercel dashboard
- Verify all dependencies are in `package.json`
- Ensure environment variables are set correctly

### Cesium Assets Not Loading
- Verify `NEXT_PUBLIC_CESIUM_ION_TOKEN` is set
- Check that postinstall script ran (should see Cesium assets copied)
- Verify `/public/cesium` directory exists in build

### Database Connection Errors
- Verify `DATABASE_URL` is correct
- Check database is accessible from Vercel's IP ranges
- Ensure SSL is enabled (`?sslmode=require`)
- Check database provider's connection limits

### API Routes Not Working
- Check function logs in Vercel dashboard
- Verify database connection
- Check environment variables are set
- Review API route code for errors

## Cost Considerations

### Vercel Free Tier
- ✅ Unlimited deployments
- ✅ 100GB bandwidth/month
- ✅ 100 serverless function invocations/day
- ✅ Automatic SSL certificates

### Database Free Tiers
- **Neon**: 0.5GB storage, shared CPU
- **Supabase**: 500MB database, 2GB bandwidth
- **Railway**: $5 credit/month
- **Render**: 90 days free, then $7/month

### Scaling
- Monitor usage in Vercel dashboard
- Upgrade plan if needed
- Consider database scaling options

## Security Best Practices

1. **Never commit secrets**: Use environment variables
2. **Enable SSL**: Always use HTTPS (automatic on Vercel)
3. **Database security**: Use strong passwords, enable SSL
4. **API security**: Consider adding rate limiting
5. **CORS**: Configure CORS if needed for API endpoints

## Next Steps

After deployment:
1. ✅ Test all features
2. ✅ Monitor performance
3. ✅ Set up custom domain (optional)
4. ✅ Configure analytics
5. ✅ Set up error monitoring
6. ✅ Create backup strategy for database

## Support

- **Vercel Docs**: [vercel.com/docs](https://vercel.com/docs)
- **Next.js Docs**: [nextjs.org/docs](https://nextjs.org/docs)
- **Cesium Docs**: [cesium.com/learn](https://cesium.com/learn)

---

**Need Help?** Check the main README.md for project-specific troubleshooting.

