from django.db import models
import uuid

# Create your models here.
class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    origin = models.CharField(max_length=255)
    batch_code = models.CharField(max_length=100, blank=True, default="")
    planting_area = models.CharField(max_length=255, blank=True, default="")
    quantity_kg = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    supplier_name = models.CharField(max_length=255, blank=True, default="")
    owner_wallet = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)

class ProductVersion(models.Model):
    product = models.ForeignKey(Product, on_delete=models.CASCADE)
    version = models.IntegerField()
    status = models.CharField(max_length=50)
    location = models.CharField(max_length=255, blank=True, default="")
    temperature_c = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    humidity_percent = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    note = models.TextField(blank=True, default="")
    image_cid = models.CharField(max_length=255)
    hash = models.TextField()
    tx_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)